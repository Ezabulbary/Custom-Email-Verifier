// Load environment variables from a local .env file if present, so `node
// server.js` works without the --env-file flag (Node 20.12+). This must run
// before any module that reads process.env at import time (e.g. firebaseAdmin).
try {
    const _fs = require('fs');
    const _envPath = require('path').join(__dirname, '.env');
    if (typeof process.loadEnvFile === 'function' && _fs.existsSync(_envPath)) {
        process.loadEnvFile(_envPath);
        console.log('[Env] Loaded .env');
    }
} catch (e) { /* older Node or no .env - fall back to real environment vars */ }

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const { parse: parseCsvSync } = require('csv-parse/sync');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const https = require('https');
const { fetchDomains } = require('./disposable');
const { verifyEmail, quickVerify, verifyCatchAll } = require('./verifier');
const { isGoogleEnabled, verifyIdToken } = require('./firebaseAdmin');
const { isEmailEnabled, sendResetEmail, sendMail } = require('./mailer');
const store = require('./store');
const totp = require('./totp');
const QRCode = require('qrcode');
const { rateLimit } = require('./rateLimit');

// Rate limiters for abuse-prone endpoints (brute force, enumeration, mail/credit
// abuse). Fixed-window, per client IP. Generous enough for real users.
const loginLimiter  = rateLimit({ name: 'login',  windowMs: 15 * 60 * 1000, max: 20, message: 'Too many login attempts. Please wait a few minutes.' });
const twofaLimiter  = rateLimit({ name: '2fa',    windowMs: 15 * 60 * 1000, max: 15, message: 'Too many 2FA attempts. Please wait a few minutes.' });
const registerLimiter = rateLimit({ name: 'reg',  windowMs: 60 * 60 * 1000, max: 15, message: 'Too many accounts created from this network. Please try later.' });
const resetLimiter  = rateLimit({ name: 'reset',  windowMs: 60 * 60 * 1000, max: 10, message: 'Too many password-reset requests. Please try later.' });
const billingLimiter = rateLimit({ name: 'billing', windowMs: 60 * 60 * 1000, max: 20, message: 'Too many payment requests. Please try later.' });

const app = express();
app.disable('x-powered-by'); // don't advertise the framework/version

// Behind nginx (or any reverse proxy), Express must be told how many proxy hops
// to trust so req.ip / req.secure are derived from the RIGHT X-Forwarded-* entry
// and NOT from a value the client prepended. Default 1 (a single nginx in front);
// set TRUST_PROXY=0 when the app is exposed directly, or a larger number / a
// preset ('loopback', a CIDR) for multiple proxies.
const _tp = process.env.TRUST_PROXY;
app.set('trust proxy', _tp === undefined ? 1 : (/^\d+$/.test(_tp) ? Number(_tp) : _tp));

// Baseline security headers on every response (no external dependency). HSTS is
// only sent over HTTPS (and without includeSubDomains, so it can't force sibling
// subdomains onto TLS). A restrictive Content-Security-Policy is intentionally
// left to the reverse proxy, since this app uses inline styles + Google Fonts +
// Firebase + Stripe and a wrong CSP silently breaks the UI.
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');                 // no clickjacking / embedding
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
});

console.log(`[Store] Active data store: ${store.backend.toUpperCase()}`);

// Limit uploads: max 15 MB and only accept CSV files, to avoid disk/CPU DoS
// from arbitrarily large or non-CSV uploads (15 MB comfortably holds 100k+ rows).
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        const ok = file.mimetype === 'text/csv'
            || file.mimetype === 'application/vnd.ms-excel'
            || file.mimetype === 'text/plain'
            || /\.(csv|txt)$/i.test(file.originalname);
        cb(ok ? null : new Error('Only CSV or TXT files are allowed'), ok);
    }
});

// Restrict CORS to configured origins in production; default to permissive only
// when no allow-list is set (development convenience).
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : {}));

// --- Billing: credit packs (server is the source of truth for prices) ---
// These MUST mirror the public pricing page (Free is the 100-credit signup
// bonus and isn't purchasable): Starter $19 → 10,000 credits, Pro $49 → 50,000.
const CREDIT_PACKS = [
    { id: 'starter', name: 'Starter', credits: 10000, price: 19, currency: 'USD', tag: 'Most popular' },
    { id: 'pro',     name: 'Pro',     credits: 50000, price: 49, currency: 'USD', tag: null },
];
const packById = (id) => CREDIT_PACKS.find(p => p.id === id) || null;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Stripe webhook - MUST read the RAW body to verify the signature, so it is
// mounted with express.raw BEFORE the global express.json() below. On a
// completed checkout it credits the buyer's account by the pack's credits.
app.post('/billing/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!STRIPE_WEBHOOK_SECRET) return res.status(400).send('Webhook not configured');
    const sig = String(req.headers['stripe-signature'] || '');
    const payload = req.body; // Buffer (raw)

    // Header format: t=timestamp,v1=hexmac[,v1=hexmac...] - during a secret roll
    // Stripe sends MULTIPLE v1 signatures, so collect them all and accept if any
    // matches (each compared in constant time).
    let ts = null; const sigs = [];
    for (const kv of sig.split(',')) {
        const i = kv.indexOf('=');
        if (i === -1) continue;
        const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
        if (k === 't') ts = v;
        else if (k === 'v1') sigs.push(v);
    }
    if (!ts || sigs.length === 0) return res.status(400).send('Bad signature');

    // Replay window: reject events whose signed timestamp is older/newer than
    // 5 minutes, so a captured request can't be replayed later.
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
        return res.status(400).send('Timestamp outside tolerance');
    }

    const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET)
        .update(`${ts}.${payload.toString('utf8')}`).digest('hex');
    const ok = sigs.some(provided => provided.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected)));
    if (!ok) return res.status(400).send('Signature verification failed');

    let event;
    try { event = JSON.parse(payload.toString('utf8')); } catch { return res.status(400).send('Bad JSON'); }

    if (event.type === 'checkout.session.completed') {
        const s = event.data.object || {};
        const userId = (s.metadata && s.metadata.userId) || s.client_reference_id;
        const credits = parseInt(s.metadata && s.metadata.credits, 10);
        // TEST-MODE events never grant credits - only a REAL (live-mode) payment
        // whose session actually completed as paid adds credits to the account.
        if (event.livemode !== true) {
            console.log(`[Billing] Ignored TEST-mode Stripe event ${event.id || ''} - no credits granted.`);
        } else if (s.payment_status && s.payment_status !== 'paid') {
            console.log(`[Billing] Session ${s.id} completed but payment_status=${s.payment_status} - no credits granted.`);
        } else if (userId && credits > 0) {
            // Idempotency: Stripe retries deliveries, and a duplicate must never
            // grant credits twice. claimBillingEvent() succeeds only the FIRST
            // time this event id is seen.
            const firstTime = await store.claimBillingEvent(event.id || `${s.id}:completed`);
            if (!firstTime) {
                console.log(`[Billing] Duplicate Stripe event ${event.id} ignored.`);
            } else {
                try {
                    await store.adjustCredits(userId, credits);
                    await store.logCredit(userId, { delta: credits, kind: 'purchase', by: 'stripe', note: `Stripe ${s.id}` });
                    console.log(`[Billing] Granted ${credits} credits to user ${userId} (Stripe ${s.id}).`);
                } catch (e) { console.error('[Billing] credit grant failed:', e.message); }
            }
        }
    }
    res.json({ received: true });
});

// Large bulk pastes (10k+ emails) need a bigger JSON body limit.
app.use(express.json({ limit: '15mb' }));

// Never ship a hardcoded secret: require JWT_SECRET in production. In
// development, if none is set, persist a generated secret to a local file so
// sessions survive server restarts (otherwise a random per-process secret would
// invalidate every token on restart - which shows up as "refresh logs me out").
const JWT_SECRET = process.env.JWT_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
        console.error('FATAL: JWT_SECRET must be set in production.');
        process.exit(1);
    }
    const secretPath = require('path').join(__dirname, '.jwt_secret');
    try {
        if (fs.existsSync(secretPath)) {
            const s = fs.readFileSync(secretPath, 'utf8').trim();
            if (s) { console.warn('[Security] JWT_SECRET not set - using the persisted dev secret (.jwt_secret). Set JWT_SECRET in .env for production.'); return s; }
        }
        const s = crypto.randomBytes(48).toString('hex');
        fs.writeFileSync(secretPath, s, { mode: 0o600 });
        console.warn('[Security] JWT_SECRET not set - generated a persistent dev secret (.jwt_secret) so sessions survive restarts. Set JWT_SECRET in .env for production.');
        return s;
    } catch (e) {
        console.warn('[Security] JWT_SECRET not set and .jwt_secret unavailable - using an ephemeral secret (sessions reset on restart).');
        return crypto.randomBytes(48).toString('hex');
    }
})();

// Load disposable domains at startup
fetchDomains().then(() => {
    console.log('Disposable domains loaded. Ready to verify.');
});

// --- Diagnostic: outbound port 25 ---
// Real SMTP mailbox verification REQUIRES outbound TCP port 25. Most cloud/VPS
// hosts block it by default, which makes most results come back "unknown" and
// tanks accuracy. Probe it at startup and warn loudly so this isn't a mystery.
let port25Open = null; // null = unknown/checking, true/false once probed
(function checkPort25() {
    const net = require('net');
    const s = new net.Socket();
    let done = false;
    const finish = (open, why) => {
        if (done) return; done = true; s.destroy();
        port25Open = open;
        if (open) {
            console.log('[Diag] Outbound port 25 is OPEN - SMTP mailbox verification is available.');
        } else {
            console.warn('==================================================================');
            console.warn(`[Diag] Outbound port 25 appears BLOCKED (${why}).`);
            console.warn('       SMTP mailbox checks cannot run, so most results will be');
            console.warn('       "unknown" and accuracy will be LOW (this is the #1 cause of');
            console.warn('       poor results). Fixes: ask your host to unblock port 25, run');
            console.warn('       on a host that allows it, or plug in a verification API.');
            console.warn('       See README.md §4.');
            console.warn('==================================================================');
        }
    };
    s.setTimeout(8000, () => finish(false, 'timeout'));
    s.on('error', (e) => finish(false, e.code || e.message));
    try { s.connect(25, 'gmail-smtp-in.l.google.com', () => finish(true)); }
    catch (e) { finish(false, e.message); }
})();

app.get('/health', (req, res) => {
    res.json({ status: 'ok', store: store.backend, port25: port25Open });
});

// --- Auth Endpoints ---

// Reject '/' as well as whitespace/@: the lowercased email is used as the
// Firestore document id, and a '/' would be interpreted as a collection-path
// separator (corrupting the path). Real-world email addresses never contain
// '/', so excluding it is safe and closes that injection vector.
const EMAIL_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;

// Roles, highest to lowest. superadmin > admin > user.
const ROLES = ['user', 'admin', 'superadmin'];

// Configured privileged emails. SUPERADMIN_EMAIL becomes superadmin, ADMIN_EMAIL
// becomes admin - on startup (even for already-registered accounts) and at signup.
const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();

// Decide the role a brand-new (or bootstrapping) account should get.
function bootstrapRole(email, isFirstUser) {
    const e = (email || '').toLowerCase();
    if (isFirstUser || e === SUPERADMIN_EMAIL) return 'superadmin';
    if (e === ADMIN_EMAIL) return 'admin';
    return 'user';
}

// Promote configured privileged emails on startup (best-effort).
(async () => {
    try {
        if (SUPERADMIN_EMAIL) {
            const n = await store.promoteByEmail(SUPERADMIN_EMAIL, 'superadmin');
            if (n > 0) console.log(`[Admin] ${SUPERADMIN_EMAIL} promoted to superadmin.`);
        }
        if (ADMIN_EMAIL) {
            // Don't demote a superadmin if the same email was set for both.
            const n = await store.promoteByEmail(ADMIN_EMAIL, 'admin', { skipIfSuperadmin: true });
            if (n > 0) console.log(`[Admin] ${ADMIN_EMAIL} promoted to admin.`);
        }
    } catch (e) {
        console.error('[Admin] Startup promotion failed:', e.message);
    }
})();

app.post('/auth/register', registerLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Invalid input' });
    }
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address' });
    if (password.length < 8 || password.length > 200) {
        return res.status(400).json({ error: 'Password must be between 8 and 200 characters' });
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        // First-ever user → superadmin; configured emails get their roles.
        const isFirst = (await store.countUsers()) === 0;
        const role = bootstrapRole(email, isFirst);
        const user = await store.createUser({ email, password: hash, credits: 100, role });
        res.json({ success: true, message: 'User registered successfully', userId: user.id, role });
    } catch (err) {
        if (err.code === 'EMAIL_EXISTS') return res.status(400).json({ error: 'Email already exists' });
        console.error('Register error:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/auth/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Invalid email or password' });
    }
    // Validate the format before it's used as a Firestore document id. Same
    // generic message as a wrong password, so this never reveals whether an
    // account exists.
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email or password' });

    try {
        const user = await store.findUserByEmail(email);
        if (!user) return res.status(400).json({ error: 'Invalid email or password' });
        if (!user.password) return res.status(400).json({ error: 'This account uses Google sign-in. Continue with Google.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'Invalid email or password' });

        // If 2FA (authenticator app) is enabled, don't issue the real token yet -
        // return a short-lived tempToken and require a code via /auth/2fa/verify.
        const twoFA = await store.getTwoFactor(user.id);
        if (twoFA && twoFA.totpEnabled) {
            const tempToken = jwt.sign({ id: user.id, twofa: true }, JWT_SECRET, { expiresIn: '10m' });
            return res.json({ twoFactorRequired: true, tempToken });
        }

        const token = jwt.sign({ id: user.id, email: user.email, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, email: user.email, credits: user.credits, role: user.role || 'user' } });
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// Step 2 of login when 2FA is on: exchange tempToken + authenticator code for a
// real session token.
app.post('/auth/2fa/verify', twofaLimiter, async (req, res) => {
    const { tempToken, code } = req.body || {};
    let payload;
    try { payload = jwt.verify(tempToken, JWT_SECRET); }
    catch { return res.status(401).json({ error: 'This sign-in session expired. Please log in again.' }); }
    if (!payload || !payload.twofa) return res.status(400).json({ error: 'Invalid session' });
    try {
        const twoFA = await store.getTwoFactor(payload.id);
        if (!twoFA || !twoFA.totpEnabled || !twoFA.totpSecret) return res.status(400).json({ error: '2FA is not enabled' });
        if (!totp.verify(twoFA.totpSecret, code)) return res.status(400).json({ error: 'Invalid or expired code' });
        const user = await store.getUserById(payload.id);
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, email: user.email, credits: user.credits, role: user.role || 'user' } });
    } catch (e) {
        console.error('2FA verify error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// Google sign-in / sign-up. The frontend obtains a Firebase ID token via the
// Google popup and posts it here; we verify it with firebase-admin, then find
// or create the user and issue our own app JWT (so the rest of the API is
// unchanged). Google accounts are stored with a NULL password.
app.post('/auth/google', async (req, res) => {
    const { idToken } = req.body || {};
    if (!idToken || typeof idToken !== 'string') {
        return res.status(400).json({ error: 'Missing Google token' });
    }
    if (!isGoogleEnabled()) {
        return res.status(501).json({ error: 'Google sign-in is not configured on the server.' });
    }

    let decoded;
    try {
        decoded = await verifyIdToken(idToken);
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired Google token' });
    }

    const email = (decoded.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'Google account has no email address' });

    const issue = (u) => {
        const token = jwt.sign({ id: u.id, email: u.email, role: u.role || 'user' }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: u.id, email: u.email, credits: u.credits, role: u.role || 'user' } });
    };

    try {
        const existing = await store.findUserByEmail(email);
        if (existing) return issue(existing);

        // First-ever user → superadmin; configured emails get their roles.
        const isFirst = (await store.countUsers()) === 0;
        const role = bootstrapRole(email, isFirst);
        try {
            const user = await store.createUser({ email, password: null, credits: 100, role });
            issue(user);
        } catch (insErr) {
            if (insErr.code === 'EMAIL_EXISTS') {
                const u2 = await store.findUserByEmail(email);
                return u2 ? issue(u2) : res.status(500).json({ error: 'Database error' });
            }
            throw insErr;
        }
    } catch (err) {
        console.error('Google auth error:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// Front-end origin used to build the reset link in the email.
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Deliver the reset link. If SMTP is configured (see mailer.js), send a real
// email; otherwise, and on any send failure, log the link to the console so the
// flow still works in development.
async function deliverResetEmail(email, link) {
    if (isEmailEnabled()) {
        try {
            await sendResetEmail(email, link);
            console.log(`[Reset] Reset email sent to ${email}.`);
            return;
        } catch (e) {
            // Loud, actionable - if reset emails aren't arriving, the SMTP error
            // (bad credentials, wrong host/port, blocked outbound 587/465) is here.
            console.error(`[Reset] FAILED to send reset email to ${email}:`, (e && e.stack) || e);
            console.error('[Reset] Check SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM in your .env.');
            // fall through to logging so a mail outage doesn't fully break resets
        }
    } else {
        // SMTP isn't configured at all - this is the #1 reason "forgot password"
        // seems to do nothing. Say so loudly instead of silently swallowing it.
        console.warn('[Reset] SMTP is NOT configured - no email can be sent. '
            + 'Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM in .env to enable password-reset emails.');
    }
    // Always surface the link in the server log so the flow is usable even
    // without a mail server (copy it from the console / PM2 logs).
    console.log(`\n[Reset] Password-reset link for ${email}:\n  ${link}\n`);
}

// Request a password reset. Always responds success (no account enumeration).
app.post('/auth/forgot-password', resetLimiter, async (req, res) => {
    const email = (req.body && req.body.email || '').trim().toLowerCase();
    const ok = () => res.json({ success: true });
    if (!email || !EMAIL_RE.test(email)) return ok();

    try {
        const user = await store.findUserByEmail(email);
        // Only send for real accounts that use a password (not Google-only).
        if (!user || !user.password) return ok();

        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = sha256(token);
        const expiresAt = Date.now() + RESET_TTL_MS;

        await store.createReset(user.id, tokenHash, expiresAt);
        deliverResetEmail(user.email, `${FRONTEND_URL}/reset-password?token=${token}`);
    } catch (e) {
        console.error('Forgot-password error:', e.message);
    }
    return ok(); // respond success either way
});

// Complete a password reset using the emailed token.
app.post('/auth/reset-password', async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Invalid reset link' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
        return res.status(400).json({ error: 'Password must be between 8 and 200 characters' });
    }

    try {
        const tokenHash = sha256(token);
        const row = await store.getActiveReset(tokenHash);
        if (!row || row.expires_at < Date.now()) {
            return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
        }

        const hash = await bcrypt.hash(password, 10);
        await store.setPassword(row.user_id, hash);
        // Consume this token and invalidate any other outstanding ones.
        await store.consumeUserResets(row.user_id);
        res.json({ success: true });
    } catch (e) {
        console.error('Reset-password error:', e.message);
        res.status(500).json({ error: 'Database error' });
    }
});

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.status(401).json({ error: 'Unauthorized' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Forbidden' });
        // A pre-2FA token (issued by /auth/login when 2FA is on) is NOT a session
        // token - it only authorises /auth/2fa/verify. Reject it everywhere else,
        // otherwise anyone with just the password could skip the second factor.
        if (user && user.twofa) return res.status(403).json({ error: 'Two-factor verification required' });
        req.user = user;
        next();
    });
}

app.get('/auth/me', authenticateToken, async (req, res) => {
    try {
        const user = await store.getUserById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: 'Database error' });
    }
});

// Update the signed-in user's own profile (name / phone / address). Email,
// role and credits are NOT editable here.
const PROFILE_KEYS = ['firstName', 'lastName', 'phone', 'address', 'city', 'zip', 'country', 'state'];
app.patch('/auth/profile', authenticateToken, async (req, res) => {
    const body = req.body || {};
    const fields = {};
    for (const k of PROFILE_KEYS) {
        if (body[k] !== undefined) {
            if (typeof body[k] !== 'string') return res.status(400).json({ error: `Invalid ${k}` });
            fields[k] = body[k];
        }
    }
    try {
        await store.updateProfile(req.user.id, fields);
        const user = await store.getUserById(req.user.id);
        res.json(user);
    } catch (e) {
        console.error('Update profile error:', e.message);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// Change the signed-in user's own password. Requires the current password -
// except for Google-only accounts (no password yet), which can set one.
app.post('/auth/change-password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 200) {
        return res.status(400).json({ error: 'New password must be between 8 and 200 characters' });
    }
    try {
        const currentHash = await store.getPasswordById(req.user.id);
        if (currentHash) {
            if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, currentHash))) {
                return res.status(400).json({ error: 'Current password is incorrect' });
            }
        }
        const hash = await bcrypt.hash(newPassword, 10);
        await store.setPassword(req.user.id, hash);
        res.json({ success: true });
    } catch (e) {
        console.error('Change password error:', e.message);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

// --- Two-Factor Authentication (Authenticator App / TOTP) ---
// Enrolment is a two-step handshake so we never enable 2FA on an unverified
// secret: (1) /setup mints a secret + QR and stores it as *pending* (not yet
// enabled); (2) /enable turns it on only after the user proves they can read a
// code from their app. /disable requires a valid code to switch it back off.

// Step 1: create a pending secret and return the QR + otpauth URL to scan.
app.post('/auth/2fa/totp/setup', authenticateToken, async (req, res) => {
    try {
        const user = await store.getUserById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const secret = totp.generateSecret();
        // Store as pending - totpEnabled stays false until /enable succeeds.
        await store.setTwoFactor(req.user.id, { totpSecret: secret, totpEnabled: false });
        const url = totp.otpauthURL(secret, user.email);
        let qrDataUrl = null;
        try { qrDataUrl = await QRCode.toDataURL(url); }
        catch (e) { console.error('QR generation failed:', e.message); }
        res.json({ secret, otpauthUrl: url, qrDataUrl });
    } catch (e) {
        console.error('2FA setup error:', e.message);
        res.status(500).json({ error: 'Failed to start 2FA setup' });
    }
});

// Step 2: verify the first code and flip 2FA on.
app.post('/auth/2fa/totp/enable', authenticateToken, async (req, res) => {
    const { code } = req.body || {};
    try {
        const twoFA = await store.getTwoFactor(req.user.id);
        if (!twoFA || !twoFA.totpSecret) {
            return res.status(400).json({ error: 'Start setup first' });
        }
        if (twoFA.totpEnabled) return res.status(400).json({ error: '2FA is already enabled' });
        if (!totp.verify(twoFA.totpSecret, code)) {
            return res.status(400).json({ error: 'Invalid or expired code' });
        }
        await store.setTwoFactor(req.user.id, { totpEnabled: true });
        res.json({ success: true, totpEnabled: true });
    } catch (e) {
        console.error('2FA enable error:', e.message);
        res.status(500).json({ error: 'Failed to enable 2FA' });
    }
});

// Turn 2FA off - requires a valid code (or the current password would also be
// acceptable; we keep it to a code for simplicity).
app.post('/auth/2fa/totp/disable', authenticateToken, async (req, res) => {
    const { code } = req.body || {};
    try {
        const twoFA = await store.getTwoFactor(req.user.id);
        if (!twoFA || !twoFA.totpEnabled || !twoFA.totpSecret) {
            return res.status(400).json({ error: '2FA is not enabled' });
        }
        if (!totp.verify(twoFA.totpSecret, code)) {
            return res.status(400).json({ error: 'Invalid or expired code' });
        }
        await store.setTwoFactor(req.user.id, { totpSecret: null, totpEnabled: false });
        res.json({ success: true, totpEnabled: false });
    } catch (e) {
        console.error('2FA disable error:', e.message);
        res.status(500).json({ error: 'Failed to disable 2FA' });
    }
});

// Admin guard - allows admin AND superadmin. Exposes the live role on req so
// handlers can apply superadmin-only rules.
async function requireAdmin(req, res, next) {
    try {
        const role = await store.getRoleById(req.user.id);
        if (role !== 'admin' && role !== 'superadmin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        req.viewerRole = role;
        next();
    } catch (e) {
        res.status(500).json({ error: 'Database error' });
    }
}

// --- Verification history (retained ~1 month, via the store) ---

const HISTORY_RETENTION_DAYS = store.HISTORY_RETENTION_DAYS;

// Save an execution as a numbered batch. History is best-effort - a failure
// here never fails the verification request itself.
async function saveBatch(userId, type, results, name) {
    try {
        return await store.createBatch(userId, { type, name, results });
    } catch (err) {
        // Loud, actionable log - if batches aren't showing in Tasks & Results,
        // the reason (e.g. a Firestore permission/quota error) shows up here.
        console.error(`[History] FAILED to save ${type} batch for user ${userId}:`, (err && err.stack) || err);
        return null;
    }
}

async function cleanupHistory() {
    try { await store.cleanupOldBatches(); }
    catch (err) { console.error('History cleanup error:', err.message); }
}
// Purge expired history at startup and periodically thereafter.
cleanupHistory();
setInterval(cleanupHistory, 6 * 60 * 60 * 1000);

// --- Verification Endpoints (Protected) ---

// A credit is charged ONLY for emails we could conclusively check. A 'unknown'
// result means verification failed (SMTP unreachable, timeout, greylisting) -
// those are never charged. Every other fine-grained status (safe, role,
// catch-all, disposable, invalid, inbox_full, disabled, spamtrap) is a
// definitive answer and is chargeable.
const isChargeable = (status) => !!status && status !== 'unknown' && status !== 'not_catch_all';
const CHARGEABLE = { has: isChargeable };   // keep the .has(...) call-sites working
const chargeableCount = (results) => results.reduce((n, r) => n + (r && isChargeable(r.status) ? 1 : 0), 0);

// How many emails to verify concurrently in bulk/CSV runs.
const VERIFY_CONCURRENCY = Math.max(1, parseInt(process.env.VERIFY_CONCURRENCY, 10) || 10);

app.post('/verify', authenticateToken, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const user = await store.getUserById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        // Atomically reserve 1 credit so concurrent single checks can't overspend
        // a low balance. Refunded below if the result turns out non-chargeable.
        const reservation = await store.reserveCredits(req.user.id, 1);
        if (!reservation.ok) return res.status(402).json({ error: 'Insufficient credits' });

        let result;
        try {
            result = await verifyEmail(email);
        } catch (e) {
            await store.adjustCredits(req.user.id, 1); // refund on failure
            throw e;
        }
        // Charge only for a conclusive verdict; refund the reserved credit otherwise.
        const charge = CHARGEABLE.has(result.status) ? 1 : 0;
        if (!charge) await store.adjustCredits(req.user.id, 1);
        else await store.addUsedCredits(req.user.id, 1);
        const batch = await saveBatch(req.user.id, 'single', [result], (req.body.name || '').toString().slice(0, 120) || null);

        res.json({ ...result, charged: charge, batchId: batch && batch.id, batchNumber: batch && batch.batchNumber });
    } catch (err) {
        console.error('Verify error:', err.message);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// Bounded-concurrency pool that processes EVERY item (never skips) and reports
// progress after each one completes.
async function asyncPoolProgress(poolLimit, array, iteratorFn, onDone) {
    const results = new Array(array.length);
    let next = 0;
    async function worker() {
        while (next < array.length) {
            const i = next++;
            try { results[i] = await iteratorFn(array[i], i); }
            catch (e) { results[i] = { email: array[i], status: 'unknown', reason: 'Verification error', confidence: 0 }; }
            if (onDone) onDone();
        }
    }
    const n = Math.min(poolLimit, array.length) || 1;
    await Promise.all(Array.from({ length: n }, worker));
    return results;
}

// --- Background verification jobs ---
// Large bulk/CSV runs are processed in the background so the HTTP request returns
// immediately (no request timeout) and every address is verified (no skips).
// Progress is polled via GET /verify/status/:jobId; the finished batch is saved
// to the store on completion.
const jobs = new Map();
let jobSeq = 0;
const makeJobId = () => `job_${jobSeq++}_${Math.round(process.hrtime()[1])}`;

// Fast domain-level bounce checks run at higher concurrency (DNS only, no SMTP).
const QUICK_CONCURRENCY = Math.max(1, parseInt(process.env.QUICK_CONCURRENCY, 10) || 50);

async function runJob(job) {
    try {
        const verifyFn = job.verifyFn || verifyEmail;
        job.results = await asyncPoolProgress(
            job.concurrency || VERIFY_CONCURRENCY, job.emails,
            async (email, i) => {
                const r = await verifyFn(email);
                // Attach the original CSV row (all its columns) so the download
                // can include every source column alongside the verdict.
                if (job.sources && job.sources[i]) r.source = job.sources[i];
                return r;
            },
            () => { job.processed++; }
        );
        // Credits were reserved up front (job.reserved). Bill only the addresses
        // that were successfully checked and REFUND the rest, so we never charge
        // for 'unknown' results and never double-charge.
        if (job.charge) {
            const charge = Math.min(chargeableCount(job.results), job.reserved || 0);
            const refund = (job.reserved || 0) - charge;
            if (refund > 0) await store.adjustCredits(job.userId, refund);
            if (charge > 0) await store.addUsedCredits(job.userId, charge);
            job.charged = charge;
        } else {
            job.charged = 0;
        }
        const batch = await saveBatch(job.userId, job.type, job.results, job.name);
        job.batchId = batch && batch.id;
        job.batchNumber = batch && batch.batchNumber;
        job.status = 'completed';
    } catch (err) {
        console.error('Job error:', err.message);
        job.status = 'error';
        job.error = 'Verification failed';
        // The job failed before billing - refund everything we reserved so a
        // crash never silently eats the user's credits.
        if (job.charge && job.reserved > 0) {
            try { await store.adjustCredits(job.userId, job.reserved); } catch {}
        }
    }
    // Free the job from memory a while after it finishes.
    setTimeout(() => jobs.delete(job.id), 10 * 60 * 1000);
}

// Hard cap on how many addresses a single job may process. Prevents a single
// upload (incl. the free /bounce path) from spawning hundreds of thousands of
// DNS/SMTP lookups and holding a giant results array in memory.
const MAX_EMAILS_PER_JOB = Math.max(1, parseInt(process.env.MAX_EMAILS_PER_JOB, 10) || 50000);

// opts: { type, emails, name, sources, verifyFn, charge, concurrency }
async function startVerificationJob(req, res, opts) {
    const { type, emails, name, sources = null, verifyFn = verifyEmail, charge = true, concurrency } = opts;
    if (emails.length > MAX_EMAILS_PER_JOB) {
        return res.status(413).json({ error: `Too many addresses in one job (max ${MAX_EMAILS_PER_JOB.toLocaleString()}). Split the list into smaller files.` });
    }
    const user = await store.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Billing jobs: ATOMICALLY reserve one credit per address up front, so
    // concurrent jobs can't each pass a stale balance check and overspend. Only
    // successful checks are actually billed - unused credits are refunded when
    // the job finishes. Free jobs (bounce) skip this entirely.
    let reserved = 0;
    if (charge) {
        const r = await store.reserveCredits(req.user.id, emails.length);
        if (!r.ok) {
            return res.status(402).json({ error: `Insufficient credits: need ${emails.length}, have ${r.credits}` });
        }
        reserved = emails.length;
    }
    const job = {
        id: makeJobId(), userId: req.user.id, type, name,
        emails, sources, verifyFn, charge, concurrency, reserved,
        total: emails.length, processed: 0,
        results: null, status: 'processing', createdAt: Date.now(),
    };
    jobs.set(job.id, job);
    runJob(job); // fire-and-forget; progress via /verify/status/:jobId
    res.json({ jobId: job.id, total: job.total, status: 'processing' });
}

app.post('/verify/bulk', authenticateToken, async (req, res) => {
    const emails = Array.isArray(req.body.emails)
        ? req.body.emails.map(e => String(e).trim()).filter(Boolean) : null;
    const name = (req.body.name || '').toString().slice(0, 120) || null;
    if (!emails || emails.length === 0) {
        return res.status(400).json({ error: 'Array of emails is required' });
    }
    try {
        await startVerificationJob(req, res, { type: 'bulk', emails, name });
    } catch (err) {
        console.error('Bulk verify error:', err.message);
        res.status(500).json({ error: 'Bulk verification failed' });
    }
});

// Parse an uploaded CSV/TXT into { emails, sources } - KEEPING every original
// column. Robust to header name, column position, delimiter, BOM, quoting, and
// whether there's a header row at all: the email is found by VALUE. `sources[i]`
// is the full original row (as an object keyed by header) for emails[i], so the
// downloaded results can include all original columns + the verdict.
const CSV_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Read the column-mapping choices the frontend modal sends as multipart fields.
// All are optional; when absent the parser auto-detects (legacy behaviour).
//   emailCol : index of the email column (-1 = auto-detect)
//   hasHeader: 'yes' | 'no' | 'auto'  (does the first row contain labels?)
//   dedupe   : remove duplicate emails? (default true)
//   labels   : JSON array of per-column names to use in the exported output
function csvOptsFromBody(body = {}) {
    const rawCol = body.emailCol;
    let emailCol = -1;
    if (rawCol !== undefined && rawCol !== null && String(rawCol).trim() !== '') {
        const n = parseInt(rawCol, 10);
        if (!Number.isNaN(n)) emailCol = n;
    }
    const hasHeader = body.hasHeader === 'yes' ? 'yes' : body.hasHeader === 'no' ? 'no' : 'auto';
    const dedupe = !(body.dedupe === '0' || body.dedupe === 'false' || body.dedupe === false);
    let labels = null;
    if (body.labels) {
        // Cap both the column count and each label's length so a hostile client
        // can't inflate memory or the exported CSV with a giant labels array.
        try {
            const p = JSON.parse(body.labels);
            if (Array.isArray(p)) labels = p.slice(0, 256).map(x => (x == null ? '' : String(x).slice(0, 120)));
        } catch { /* ignore malformed labels */ }
    }
    return { emailCol, hasHeader, dedupe, labels };
}

function parseCsvRows(buf, opts = {}) {
    const { emailCol: wantCol = -1, hasHeader = 'auto', dedupe = true, labels = null } = opts;
    const content = buf.toString('utf8').replace(/^﻿/, ''); // strip BOM
    const firstLine = content.split(/\r?\n/).find(l => l.trim()) || '';
    const occ = (ch) => firstLine.split(ch).length - 1;
    const delimiter = occ('\t') > occ(',') && occ('\t') > occ(';') ? '\t'
        : occ(';') > occ(',') ? ';' : ',';

    let records;
    try {
        records = parseCsvSync(content, {
            columns: false, skip_empty_lines: true, relax_column_count: true,
            relax_quotes: true, delimiter, trim: true,
        });
    } catch {
        records = content.split(/\r?\n/).filter(l => l.trim()).map(l => [l]);
    }
    if (!records.length) return { emails: [], sources: [] };

    const width = Math.max(...records.map(r => r.length));
    const rowHasEmail = (r) => r.some(c => CSV_EMAIL_RE.test(String(c || '').trim()));

    // Header row: honour the modal's explicit yes/no; otherwise auto-detect
    // (a first row with NO email while later rows have one).
    let headerRow = null, dataStart = 0;
    if (hasHeader === 'yes') {
        headerRow = records[0]; dataStart = 1;
    } else if (hasHeader === 'no') {
        headerRow = null; dataStart = 0;
    } else if (!rowHasEmail(records[0]) && records.slice(1, 6).some(rowHasEmail)) {
        headerRow = records[0]; dataStart = 1;
    }

    // Column names for the exported output: explicit modal labels win, then the
    // file's own header, then a generic "Column N".
    const headers = [];
    for (let c = 0; c < width; c++) {
        const label = labels && labels[c] != null ? String(labels[c]).trim() : '';
        const fromFile = headerRow && headerRow[c] != null ? String(headerRow[c]).trim() : '';
        headers.push(label || fromFile || `Column ${c + 1}`);
    }

    // Which column holds emails: explicit modal choice wins, else scan samples.
    let emailCol = (Number.isInteger(wantCol) && wantCol >= 0 && wantCol < width) ? wantCol : -1;
    if (emailCol === -1) {
        const sample = records.slice(dataStart, dataStart + 25);
        for (let c = 0; c < width; c++) {
            if (sample.some(r => CSV_EMAIL_RE.test(String(r[c] || '').trim()))) { emailCol = c; break; }
        }
    }

    const emails = [], sources = [], seen = new Set();
    for (let i = dataStart; i < records.length; i++) {
        const r = records[i];
        let email = emailCol >= 0 ? String(r[emailCol] || '').trim() : '';
        if (!CSV_EMAIL_RE.test(email)) {
            const found = r.find(c => CSV_EMAIL_RE.test(String(c || '').trim()));
            email = found ? String(found).trim() : '';
        }
        if (!CSV_EMAIL_RE.test(email)) continue;
        const key = email.toLowerCase();
        if (dedupe) {
            if (seen.has(key)) continue;      // de-duplicate
            seen.add(key);
        }
        const source = {};
        for (let c = 0; c < width; c++) source[headers[c]] = r[c] != null ? String(r[c]) : '';
        emails.push(key);
        sources.push(source);
    }
    return { emails, sources };
}

app.post('/verify/csv', authenticateToken, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
    const name = (req.body.name || '').toString().slice(0, 120) || null;

    let parsed = { emails: [], sources: [] };
    try {
        parsed = parseCsvRows(fs.readFileSync(req.file.path), csvOptsFromBody(req.body));
    } catch (e) {
        console.error('CSV parse error:', e.message);
    } finally {
        fs.unlink(req.file.path, () => {});
    }

    if (parsed.emails.length === 0) {
        return res.status(400).json({ error: 'No email addresses found in the file. Make sure it has an email column, or one email per line.' });
    }
    try {
        await startVerificationJob(req, res, { type: 'csv', emails: parsed.emails, name, sources: parsed.sources });
    } catch (err) {
        console.error('CSV verify error:', err.message);
        res.status(500).json({ error: 'CSV verification failed' });
    }
});

// --- Bounce Rate check (FREE) ---
// A fast, free LIST ANALYZER, not a verifier: syntax + disposable + MX only,
// no SMTP, so it returns near-instantly and never uses credits. It answers
// "how healthy is this list?" BEFORE any credits are spent; mailbox-level
// verdicts are Email Verification's (paid) job. The old 'accurate' mode was
// removed - it duplicated Email Verification for free.
app.post('/bounce/csv', authenticateToken, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'A file is required' });
    const name = (req.body.name || '').toString().slice(0, 120) || null;

    let parsed = { emails: [], sources: [] };
    try {
        parsed = parseCsvRows(fs.readFileSync(req.file.path), csvOptsFromBody(req.body));
    } catch (e) {
        console.error('Bounce parse error:', e.message);
    } finally {
        fs.unlink(req.file.path, () => {});
    }

    if (parsed.emails.length === 0) {
        return res.status(400).json({ error: 'No email addresses found in the file. Make sure it has an email column, or one email per line.' });
    }
    try {
        await startVerificationJob(req, res, {
            type: 'bounce', emails: parsed.emails, name, sources: parsed.sources,
            verifyFn: quickVerify, charge: false, concurrency: QUICK_CONCURRENCY,
        });
    } catch (err) {
        console.error('Bounce check error:', err.message);
        res.status(500).json({ error: 'Bounce check failed' });
    }
});

// --- Catch-All Verifier (paid) ---
// Deep-resolves catch-all addresses (the hard case). Addresses on non-catch-all
// domains come back as 'not_catch_all' (not charged). Same credit rules as
// standard verification: only conclusive results are billed.
app.post('/catchall', authenticateToken, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    try {
        const user = await store.getUserById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const reservation = await store.reserveCredits(req.user.id, 1);
        if (!reservation.ok) return res.status(402).json({ error: 'Insufficient credits' });
        let result;
        try { result = await verifyCatchAll(email); }
        catch (e) { await store.adjustCredits(req.user.id, 1); throw e; }
        const charge = isChargeable(result.status) ? 1 : 0;
        if (!charge) await store.adjustCredits(req.user.id, 1);
        else await store.addUsedCredits(req.user.id, 1);
        const batch = await saveBatch(req.user.id, 'catchall', [result], (req.body.name || '').toString().slice(0, 120) || null);
        res.json({ ...result, charged: charge, batchId: batch && batch.id, batchNumber: batch && batch.batchNumber });
    } catch (err) {
        console.error('Catch-all verify error:', err.message);
        res.status(500).json({ error: 'Catch-all verification failed' });
    }
});

app.post('/catchall/bulk', authenticateToken, async (req, res) => {
    const emails = Array.isArray(req.body.emails)
        ? req.body.emails.map(e => String(e).trim()).filter(Boolean) : null;
    const name = (req.body.name || '').toString().slice(0, 120) || null;
    if (!emails || emails.length === 0) return res.status(400).json({ error: 'Array of emails is required' });
    try { await startVerificationJob(req, res, { type: 'catchall', emails, name, verifyFn: verifyCatchAll }); }
    catch (err) { console.error('Catch-all bulk error:', err.message); res.status(500).json({ error: 'Catch-all verification failed' }); }
});

app.post('/catchall/csv', authenticateToken, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'A file is required' });
    const name = (req.body.name || '').toString().slice(0, 120) || null;
    let parsed = { emails: [], sources: [] };
    try { parsed = parseCsvRows(fs.readFileSync(req.file.path), csvOptsFromBody(req.body)); }
    catch (e) { console.error('Catch-all parse error:', e.message); }
    finally { fs.unlink(req.file.path, () => {}); }
    if (parsed.emails.length === 0) return res.status(400).json({ error: 'No email addresses found in the file. Make sure it has an email column, or one email per line.' });
    try { await startVerificationJob(req, res, { type: 'catchall', emails: parsed.emails, name, sources: parsed.sources, verifyFn: verifyCatchAll }); }
    catch (err) { console.error('Catch-all CSV error:', err.message); res.status(500).json({ error: 'Catch-all verification failed' }); }
});

// --- Billing: config, Stripe checkout, and manual (Wise / bank transfer) ---
app.get('/billing/config', authenticateToken, (req, res) => {
    const wise = (process.env.WISE_PAYMENT_URL || process.env.WISE_EMAIL)
        ? { url: process.env.WISE_PAYMENT_URL || null, email: process.env.WISE_EMAIL || null } : null;
    const bankSet = ['BANK_NAME', 'BANK_HOLDER', 'BANK_ACCOUNT', 'BANK_IBAN', 'BANK_SWIFT'].some(k => process.env[k]);
    const bank = bankSet ? {
        holder: process.env.BANK_HOLDER || null, bankName: process.env.BANK_NAME || null,
        account: process.env.BANK_ACCOUNT || null, iban: process.env.BANK_IBAN || null,
        swift: process.env.BANK_SWIFT || null, notes: process.env.BANK_NOTES || null,
    } : null;
    res.json({ packs: CREDIT_PACKS, methods: { stripe: !!STRIPE_SECRET_KEY, wise: !!wise, bank: !!bank }, wise, bank });
});

// Create a Stripe Checkout Session via the REST API (no SDK dependency).
function stripeCreateCheckout(form) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams(form).toString();
        const r = https.request({
            hostname: 'api.stripe.com', path: '/v1/checkout/sessions', method: 'POST',
            headers: {
                'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
            },
        }, (resp) => {
            let d = ''; resp.on('data', c => d += c);
            resp.on('end', () => {
                try { const j = JSON.parse(d); resp.statusCode >= 400 ? reject(new Error((j.error && j.error.message) || 'Stripe error')) : resolve(j); }
                catch (e) { reject(e); }
            });
        });
        r.on('error', reject); r.write(body); r.end();
    });
}

app.post('/billing/checkout', authenticateToken, billingLimiter, async (req, res) => {
    if (!STRIPE_SECRET_KEY) return res.status(400).json({ error: 'Card payments are not configured yet. Please use Wise or bank transfer.' });
    const pack = packById(req.body.packId);
    if (!pack) return res.status(400).json({ error: 'Unknown credit pack' });
    // Where Stripe sends the buyer after checkout. Never trust the Origin header
    // blindly - a forged Origin would let an attacker bounce a paying user to
    // their own site. FRONTEND_URL wins; otherwise the Origin is accepted only
    // if it's on the CORS allow-list (or no allow-list is configured = dev).
    const reqOrigin = String(req.headers.origin || '');
    const origin = process.env.FRONTEND_URL
        || (allowedOrigins.length ? (allowedOrigins.includes(reqOrigin) ? reqOrigin : '') : reqOrigin);
    try {
        const session = await stripeCreateCheckout({
            mode: 'payment',
            'success_url': `${origin}/dashboard/billing?paid=1`,
            'cancel_url': `${origin}/dashboard/billing?canceled=1`,
            'client_reference_id': String(req.user.id),
            'metadata[userId]': String(req.user.id),
            'metadata[credits]': String(pack.credits),
            'line_items[0][quantity]': '1',
            'line_items[0][price_data][currency]': pack.currency.toLowerCase(),
            'line_items[0][price_data][unit_amount]': String(pack.price * 100),
            'line_items[0][price_data][product_data][name]': `${pack.credits.toLocaleString()} verification credits (${pack.name})`,
        });
        res.json({ url: session.url });
    } catch (err) {
        console.error('Stripe checkout error:', err.message);
        res.status(502).json({ error: 'Could not start checkout. Please try again.' });
    }
});

// Wise / international bank transfer: record the intent, notify ops, and hand
// back a reference the buyer puts in the payment note. An admin adds the credits
// once the transfer clears (via the Admin Panel).
app.post('/billing/manual', authenticateToken, billingLimiter, async (req, res) => {
    const pack = packById(req.body.packId);
    const method = ['wise', 'bank'].includes(req.body.method) ? req.body.method : null;
    if (!pack || !method) return res.status(400).json({ error: 'Invalid request' });
    const user = await store.getUserById(req.user.id);
    const reference = 'BC-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const summary = `Manual payment intent
Ref: ${reference}
User: ${user && user.email} (id ${req.user.id})
Method: ${method}
Pack: ${pack.name} - ${pack.credits.toLocaleString()} credits - ${pack.price} ${pack.currency}`;
    const adminTo = process.env.BILLING_NOTIFY_EMAIL || process.env.ADMIN_EMAIL || '';
    try { if (adminTo) await sendMail({ to: adminTo, subject: `[BounceCure] Manual payment ${reference}`, text: summary }); }
    catch (e) { console.error('Manual payment notice failed:', e.message); }
    console.log('[Billing] ' + summary.replace(/\n/g, ' | '));
    res.json({ reference, message: `Use reference ${reference} in your payment note. Your credits are added once we confirm the transfer.` });
});

// --- API keys + public API (/v1) ---
// A user can hold ONE API key. Only its SHA-256 hash is stored; the full key is
// returned once, at generation time. The public /v1 endpoints authenticate with
// the X-API-Key header and bill credits exactly like the in-app verifier.
const sha256hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

app.post('/auth/apikey/generate', authenticateToken, async (req, res) => {
    try {
        const key = 'bc_' + crypto.randomBytes(24).toString('hex');
        const prefix = key.slice(0, 11) + '…';
        await store.setApiKey(req.user.id, { hash: sha256hex(key), prefix });
        res.json({ key, prefix });   // the ONLY time the full key is returned
    } catch (e) {
        console.error('API key generate error:', e.message);
        res.status(500).json({ error: 'Could not generate an API key' });
    }
});
app.get('/auth/apikey', authenticateToken, async (req, res) => {
    try { res.json(await store.getApiKeyInfo(req.user.id) || { exists: false }); }
    catch (e) { res.status(500).json({ error: 'Could not load API key info' }); }
});
app.delete('/auth/apikey', authenticateToken, async (req, res) => {
    try { await store.clearApiKey(req.user.id); res.json({ success: true }); }
    catch (e) { res.status(500).json({ error: 'Could not revoke the API key' }); }
});

// Authenticate a /v1 request by API key. 401 on a missing/unknown key.
async function authenticateApiKey(req, res, next) {
    const key = String(req.headers['x-api-key'] || '').trim();
    if (!key || !key.startsWith('bc_')) return res.status(401).json({ error: 'Missing or invalid API key. Send it in the X-API-Key header.' });
    try {
        const user = await store.findUserByApiKeyHash(sha256hex(key));
        if (!user) return res.status(401).json({ error: 'Missing or invalid API key. Send it in the X-API-Key header.' });
        req.apiUser = user;
        next();
    } catch (e) {
        console.error('API auth error:', e.message);
        res.status(500).json({ error: 'Authentication failed' });
    }
}
// Per-key rate limit (falls back to IP when the key is absent/unknown).
const apiLimiter = rateLimit({
    name: 'api', windowMs: 60 * 1000, max: 120,
    keyGenerator: (req) => String(req.headers['x-api-key'] || '') || undefined,
    message: 'API rate limit exceeded (120 requests/minute). Slow down.',
});

// POST /v1/verify { "email": "a@b.com" } -> full verification result.
// Charges 1 credit for a conclusive status; 'unknown' is free.
app.post('/v1/verify', apiLimiter, authenticateApiKey, async (req, res) => {
    const email = req.body && req.body.email;
    if (!email || typeof email !== 'string') return res.status(400).json({ error: 'Body must be JSON: { "email": "name@example.com" }' });
    try {
        const reservation = await store.reserveCredits(req.apiUser.id, 1);
        if (!reservation.ok) return res.status(402).json({ error: 'Insufficient credits' });
        let result;
        try { result = await verifyEmail(email.trim()); }
        catch (e) { await store.adjustCredits(req.apiUser.id, 1); throw e; }
        const charge = isChargeable(result.status) ? 1 : 0;
        if (!charge) await store.adjustCredits(req.apiUser.id, 1);
        else await store.addUsedCredits(req.apiUser.id, 1);
        await saveBatch(req.apiUser.id, 'single', [result], 'API');
        res.json({
            email: result.email, status: result.status, confidence: result.confidence,
            provider: result.provider, isCatchAll: !!result.isCatchAll,
            disposable: !!result.disposable, reason: result.reason, charged: charge,
        });
    } catch (e) {
        console.error('API verify error:', e.message);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// GET /v1/credits -> current balance.
app.get('/v1/credits', apiLimiter, authenticateApiKey, (req, res) => {
    res.json({ credits: req.apiUser.credits });
});

// Poll the progress of a background bulk/CSV job.
app.get('/verify/status/:jobId', authenticateToken, (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job || String(job.userId) !== String(req.user.id)) {
        return res.status(404).json({ error: 'Job not found' });
    }
    res.json({
        status: job.status, processed: job.processed, total: job.total,
        batchId: job.batchId, batchNumber: job.batchNumber,
        charged: job.charged, error: job.error,
        // Include the results in the final response so the client doesn't need a
        // separate /history fetch to show them.
        results: job.status === 'completed' ? job.results : undefined,
    });
});

// --- History / Tasks Endpoints (Protected) ---

// List past execution batches for the logged-in user within the retention
// window. Summaries only (no per-address results) - fetch a single batch's
// results via GET /history/:id.
// Optional query: ?type=single|bulk|csv  &  ?limit=N (default 50, max 500)
app.get('/history', authenticateToken, async (req, res) => {
    const { type } = req.query;
    let limit = parseInt(req.query.limit, 10);
    if (Number.isNaN(limit) || limit < 1) limit = 50;
    if (limit > 500) limit = 500;
    // `type` may be one type or a comma-separated list (each page shows its own
    // history: Email Verification = single,bulk,csv; Catch-All = catchall; …).
    const KNOWN_TYPES = ['single', 'bulk', 'csv', 'catchall', 'bounce'];
    let typeFilter;
    if (type) {
        const parts = String(type).split(',').map(s => s.trim()).filter(t => KNOWN_TYPES.includes(t));
        typeFilter = parts.length === 0 ? undefined : (parts.length === 1 ? parts[0] : parts);
    }

    try {
        const batches = await store.listBatches(req.user.id, { type: typeFilter, limit });
        res.json({ retentionDays: HISTORY_RETENTION_DAYS, history: batches });
    } catch (e) {
        console.error('History error:', e.message);
        res.status(500).json({ error: 'Failed to load history' });
    }
});

// Full results for one batch (Details / Download).
app.get('/history/:id', authenticateToken, async (req, res) => {
    try {
        const batch = await store.getBatch(req.user.id, req.params.id);
        if (!batch) return res.status(404).json({ error: 'Batch not found' });
        res.json(batch);
    } catch (e) {
        console.error('Batch fetch error:', e.message);
        res.status(500).json({ error: 'Failed to load batch' });
    }
});

// Delete one of the logged-in user's own batches. SUPERADMIN ONLY - deleting
// history is a privileged action, so a plain user or admin cannot do it (checked
// server-side against the live role, not just hidden in the UI). Still scoped to
// req.user.id, so it only ever removes the caller's own batch.
app.delete('/history/:id', authenticateToken, async (req, res) => {
    const id = (req.params.id == null ? '' : String(req.params.id)).trim();
    if (!id) return res.status(400).json({ error: 'Invalid batch id' });
    try {
        const role = await store.getRoleById(req.user.id);
        if (role !== 'superadmin') {
            return res.status(403).json({ error: 'Only a super admin can delete tasks.' });
        }
        const removed = await store.deleteBatch(req.user.id, id);
        if (!removed) return res.status(404).json({ error: 'Batch not found' });
        res.json({ success: true });
    } catch (e) {
        console.error('Batch delete error:', e.message);
        res.status(500).json({ error: 'Failed to delete batch' });
    }
});

// Aggregate stats for the dashboard (within the retention window).
app.get('/history/stats/overview', authenticateToken, async (req, res) => {
    try {
        const s = await store.userStats(req.user.id);
        res.json({ retentionDays: HISTORY_RETENTION_DAYS, ...s });
    } catch (e) {
        console.error('Stats error:', e.message);
        res.status(500).json({ error: 'Failed to load stats' });
    }
});

// --- Admin Endpoints (Protected, admin only) ---

// List users with their verification counts. Superadmins are visible ONLY to
// superadmins; a plain admin never sees superadmin accounts.
app.get('/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await store.listUsers({ hideSuper: req.viewerRole !== 'superadmin' });
        res.json({ users, viewerRole: req.viewerRole });
    } catch (e) {
        console.error('Admin users error:', e.message);
        res.status(500).json({ error: 'Failed to load users' });
    }
});

// Platform-wide stats. For a plain admin, superadmins are excluded from the
// user/credit counts so hidden accounts don't leak through the numbers.
app.get('/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const row = await store.adminStats({ viewerRole: req.viewerRole });
        if (req.viewerRole !== 'superadmin') row.superadmins = undefined;
        res.json(row);
    } catch (e) {
        console.error('Admin stats error:', e.message);
        res.status(500).json({ error: 'Failed to load stats' });
    }
});

// A plain admin may never see or act on a superadmin - treat as not found.
const targetHiddenFromViewer = (targetRole, viewerRole) =>
    targetRole === 'superadmin' && viewerRole !== 'superadmin';

// Validate a user id from the URL. Ids are opaque (numeric for SQLite, email
// for Firestore) so we only require a non-empty value, never parseInt.
const readId = (raw) => {
    const id = (raw == null ? '' : String(raw)).trim();
    return id || null;
};

// Per-user profile for the Admin Panel: lifetime counters + the CREDIT ledger
// (who added/removed credits, purchases, signup bonus). Verification runs are
// deliberately NOT included here — they already live on Tasks & Results.
app.get('/admin/users/:id/history', authenticateToken, requireAdmin, async (req, res) => {
    const id = readId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid input' });
    try {
        const targetRole = await store.getRoleById(id);
        if (targetRole === null || targetHiddenFromViewer(targetRole, req.viewerRole)) {
            return res.status(404).json({ error: 'User not found' });
        }
        const user = await store.adminUserDetail(id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const creditLog = await store.listCreditLog(id, 200);
        res.json({ user, creditLog });
    } catch (e) {
        console.error('Admin user history error:', e.message);
        res.status(500).json({ error: 'Failed to load user history' });
    }
});

// Server-side duplicate guard: the same admin applying the SAME delta to the
// SAME account within a few seconds is almost always a double-submit (double
// Enter, double click, or a network retry), not two intended top-ups. The UI
// also locks the row while a request is in flight; this is the backstop.
const recentCreditOps = new Map(); // "admin|user|delta" -> timestamp
const CREDIT_DEDUPE_MS = 5000;
setInterval(() => {
    const now = Date.now();
    for (const [k, t] of recentCreditOps) if (now - t > CREDIT_DEDUPE_MS) recentCreditOps.delete(k);
}, 30000).unref?.();

// Largest single adjustment allowed, so a typo/paste can't mint millions.
const MAX_CREDIT_DELTA = Math.max(1, parseInt(process.env.MAX_CREDIT_DELTA, 10) || 1000000);

// Adjust a user's credits by a (positive or negative) delta.
app.post('/admin/users/:id/credits', authenticateToken, requireAdmin, async (req, res) => {
    const id = readId(req.params.id);
    const delta = parseInt(req.body.delta, 10);
    if (!id || Number.isNaN(delta)) return res.status(400).json({ error: 'Invalid input' });
    if (delta === 0) return res.status(400).json({ error: 'Amount must not be zero' });
    if (Math.abs(delta) > MAX_CREDIT_DELTA) {
        return res.status(400).json({ error: `Amount too large (max ${MAX_CREDIT_DELTA.toLocaleString()} per adjustment)` });
    }

    const opKey = `${req.user.id}|${id}|${delta}`;
    const last = recentCreditOps.get(opKey);
    if (last && Date.now() - last < CREDIT_DEDUPE_MS) {
        return res.status(409).json({ error: 'That same adjustment was just applied. Wait a moment before repeating it.' });
    }
    recentCreditOps.set(opKey, Date.now());

    try {
        const targetRole = await store.getRoleById(id);
        if (targetRole === null || targetHiddenFromViewer(targetRole, req.viewerRole)) {
            recentCreditOps.delete(opKey);       // nothing applied; let them retry
            return res.status(404).json({ error: 'User not found' });
        }
        const credits = await store.adjustCredits(id, delta);
        // Ledger entry: who changed this account's credits, when, by how much.
        await store.logCredit(id, {
            delta,
            kind: delta >= 0 ? 'admin_add' : 'admin_remove',
            by: req.user.email || String(req.user.id),
        });
        res.json({ success: true, credits });
    } catch (e) {
        recentCreditOps.delete(opKey);           // failed; don't block a retry
        console.error('Adjust credits error:', e.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// Change a user's role ('user' | 'admin' | 'superadmin').
app.post('/admin/users/:id/role', authenticateToken, requireAdmin, async (req, res) => {
    const id = readId(req.params.id);
    const role = req.body.role;
    if (!id || !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid input' });
    if (String(id) === String(req.user.id)) return res.status(400).json({ error: 'You cannot change your own role' });

    try {
        const targetRole = await store.getRoleById(id);
        if (targetRole === null || targetHiddenFromViewer(targetRole, req.viewerRole)) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Only a superadmin may grant the superadmin role or modify a superadmin.
        if ((role === 'superadmin' || targetRole === 'superadmin') && req.viewerRole !== 'superadmin') {
            return res.status(403).json({ error: 'Only a superadmin can manage the superadmin role' });
        }
        const changed = await store.setRole(id, role);
        if (changed === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, role });
    } catch (e) {
        console.error('Set role error:', e.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete a user and their history.
app.delete('/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const id = readId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid input' });
    if (String(id) === String(req.user.id)) return res.status(400).json({ error: 'You cannot delete your own account' });

    try {
        const targetRole = await store.getRoleById(id);
        if (targetRole === null || targetHiddenFromViewer(targetRole, req.viewerRole)) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Only a superadmin can delete a superadmin (already hidden from admins).
        if (targetRole === 'superadmin' && req.viewerRole !== 'superadmin') {
            return res.status(403).json({ error: 'Only a superadmin can delete a superadmin' });
        }
        const changed = await store.deleteUser(id);
        if (changed === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true });
    } catch (e) {
        console.error('Delete user error:', e.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// --- Serve the built frontend (optional; makes the app self-contained) ---
// If frontend/dist exists, this one server handles BOTH the API and the web app.
// Then your reverse proxy only needs to forward everything to this process - no
// per-path proxy rules to maintain (a missing /history or /admin rule is exactly
// what makes Tasks & Results fail with "unexpected response HTTP 200"). The API
// routes above always take precedence; anything else falls back to index.html.
const API_PREFIX_RE = /^\/(auth|verify|bounce|catchall|billing|history|admin|health|v1)(\/|$)/;
const DIST_DIR = require('path').join(__dirname, 'frontend', 'dist');
if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    app.use((req, res, next) => {
        if (req.method !== 'GET' || API_PREFIX_RE.test(req.path)) return next();
        res.sendFile(require('path').join(DIST_DIR, 'index.html'));
    });
    console.log('[Web] Serving frontend from frontend/dist - you can proxy everything to this port.');
} else {
    console.log('[Web] frontend/dist not found - running API-only (serve the frontend separately).');
}

// Error handler - turns upload/multer and other errors into clean JSON responses
// instead of leaking stack traces via the default HTML error page.
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.message === 'Only CSV or TXT files are allowed') {
        return res.status(400).json({ error: err.message });
    }
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Email Verifier API running on port ${PORT}`);
});
