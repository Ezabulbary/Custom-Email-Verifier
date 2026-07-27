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
} catch (e) { /* older Node or no .env — fall back to real environment vars */ }

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const crypto = require('crypto');
const { parse: parseCsvSync } = require('csv-parse/sync');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { fetchDomains } = require('./disposable');
const { verifyEmail, quickVerify } = require('./verifier');
const { isGoogleEnabled, verifyIdToken } = require('./firebaseAdmin');
const { isEmailEnabled, sendResetEmail } = require('./mailer');
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

const app = express();

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
// Large bulk pastes (10k+ emails) need a bigger JSON body limit.
app.use(express.json({ limit: '15mb' }));

// Never ship a hardcoded secret: require JWT_SECRET in production. In
// development, if none is set, persist a generated secret to a local file so
// sessions survive server restarts (otherwise a random per-process secret would
// invalidate every token on restart — which shows up as "refresh logs me out").
const JWT_SECRET = process.env.JWT_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
        console.error('FATAL: JWT_SECRET must be set in production.');
        process.exit(1);
    }
    const secretPath = require('path').join(__dirname, '.jwt_secret');
    try {
        if (fs.existsSync(secretPath)) {
            const s = fs.readFileSync(secretPath, 'utf8').trim();
            if (s) { console.warn('[Security] JWT_SECRET not set — using the persisted dev secret (.jwt_secret). Set JWT_SECRET in .env for production.'); return s; }
        }
        const s = crypto.randomBytes(48).toString('hex');
        fs.writeFileSync(secretPath, s, { mode: 0o600 });
        console.warn('[Security] JWT_SECRET not set — generated a persistent dev secret (.jwt_secret) so sessions survive restarts. Set JWT_SECRET in .env for production.');
        return s;
    } catch (e) {
        console.warn('[Security] JWT_SECRET not set and .jwt_secret unavailable — using an ephemeral secret (sessions reset on restart).');
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
            console.log('[Diag] Outbound port 25 is OPEN — SMTP mailbox verification is available.');
        } else {
            console.warn('==================================================================');
            console.warn(`[Diag] Outbound port 25 appears BLOCKED (${why}).`);
            console.warn('       SMTP mailbox checks cannot run, so most results will be');
            console.warn('       "unknown" and accuracy will be LOW (this is the #1 cause of');
            console.warn('       poor results). Fixes: ask your host to unblock port 25, run');
            console.warn('       on a host that allows it, or plug in a verification API.');
            console.warn('       See ACCURACY.md.');
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
// becomes admin — on startup (even for already-registered accounts) and at signup.
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

        // If 2FA (authenticator app) is enabled, don't issue the real token yet —
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
            // Loud, actionable — if reset emails aren't arriving, the SMTP error
            // (bad credentials, wrong host/port, blocked outbound 587/465) is here.
            console.error(`[Reset] FAILED to send reset email to ${email}:`, (e && e.stack) || e);
            console.error('[Reset] Check SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM in your .env.');
            // fall through to logging so a mail outage doesn't fully break resets
        }
    } else {
        // SMTP isn't configured at all — this is the #1 reason "forgot password"
        // seems to do nothing. Say so loudly instead of silently swallowing it.
        console.warn('[Reset] SMTP is NOT configured — no email can be sent. '
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
        // token — it only authorises /auth/2fa/verify. Reject it everywhere else,
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

// Change the signed-in user's own password. Requires the current password —
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
        // Store as pending — totpEnabled stays false until /enable succeeds.
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

// Turn 2FA off — requires a valid code (or the current password would also be
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

// Admin guard — allows admin AND superadmin. Exposes the live role on req so
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

// Save an execution as a numbered batch. History is best-effort — a failure
// here never fails the verification request itself.
async function saveBatch(userId, type, results, name) {
    try {
        return await store.createBatch(userId, { type, name, results });
    } catch (err) {
        // Loud, actionable log — if batches aren't showing in Tasks & Results,
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
// result means verification failed (SMTP unreachable, timeout, greylisting) —
// those are never charged. Every other fine-grained status (safe, role,
// catch-all, disposable, invalid, inbox_full, disabled, spamtrap) is a
// definitive answer and is chargeable.
const isChargeable = (status) => !!status && status !== 'unknown';
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
        // The job failed before billing — refund everything we reserved so a
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
    // successful checks are actually billed — unused credits are refunded when
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

// Parse an uploaded CSV/TXT into { emails, sources } — KEEPING every original
// column. Robust to header name, column position, delimiter, BOM, quoting, and
// whether there's a header row at all: the email is found by VALUE. `sources[i]`
// is the full original row (as an object keyed by header) for emails[i], so the
// downloaded results can include all original columns + the verdict.
const CSV_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function parseCsvRows(buf) {
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

    // Header row = a first row that has NO email while later rows do.
    let headerRow = null, dataStart = 0;
    if (!rowHasEmail(records[0]) && records.slice(1, 6).some(rowHasEmail)) {
        headerRow = records[0]; dataStart = 1;
    }
    const headers = [];
    for (let c = 0; c < width; c++) {
        const h = headerRow && headerRow[c] != null ? String(headerRow[c]).trim() : '';
        headers.push(h || `Column ${c + 1}`);
    }

    // Which column holds emails (scan sample values).
    let emailCol = -1;
    const sample = records.slice(dataStart, dataStart + 25);
    for (let c = 0; c < width; c++) {
        if (sample.some(r => CSV_EMAIL_RE.test(String(r[c] || '').trim()))) { emailCol = c; break; }
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
        if (seen.has(key)) continue;      // de-duplicate
        seen.add(key);
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
        parsed = parseCsvRows(fs.readFileSync(req.file.path));
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

// --- Bounce Rate check (FREE + FAST) ---
// Domain-level estimate: syntax + disposable + MX only (no SMTP), so it does NOT
// consume credits and returns quickly. Same job/progress mechanism as CSV.
app.post('/bounce/csv', authenticateToken, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'A file is required' });
    const name = (req.body.name || '').toString().slice(0, 120) || null;

    let parsed = { emails: [], sources: [] };
    try {
        parsed = parseCsvRows(fs.readFileSync(req.file.path));
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
// window. Summaries only (no per-address results) — fetch a single batch's
// results via GET /history/:id.
// Optional query: ?type=single|bulk|csv  &  ?limit=N (default 50, max 500)
app.get('/history', authenticateToken, async (req, res) => {
    const { type } = req.query;
    let limit = parseInt(req.query.limit, 10);
    if (Number.isNaN(limit) || limit < 1) limit = 50;
    if (limit > 500) limit = 500;
    const typeFilter = ['single', 'bulk', 'csv'].includes(type) ? type : undefined;

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

// Delete one of the logged-in user's own batches. SUPERADMIN ONLY — deleting
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

// A plain admin may never see or act on a superadmin — treat as not found.
const targetHiddenFromViewer = (targetRole, viewerRole) =>
    targetRole === 'superadmin' && viewerRole !== 'superadmin';

// Validate a user id from the URL. Ids are opaque (numeric for SQLite, email
// for Firestore) so we only require a non-empty value, never parseInt.
const readId = (raw) => {
    const id = (raw == null ? '' : String(raw)).trim();
    return id || null;
};

// Adjust a user's credits by a (positive or negative) delta.
app.post('/admin/users/:id/credits', authenticateToken, requireAdmin, async (req, res) => {
    const id = readId(req.params.id);
    const delta = parseInt(req.body.delta, 10);
    if (!id || Number.isNaN(delta)) return res.status(400).json({ error: 'Invalid input' });

    try {
        const targetRole = await store.getRoleById(id);
        if (targetRole === null || targetHiddenFromViewer(targetRole, req.viewerRole)) {
            return res.status(404).json({ error: 'User not found' });
        }
        const credits = await store.adjustCredits(id, delta);
        res.json({ success: true, credits });
    } catch (e) {
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
// Then your reverse proxy only needs to forward everything to this process — no
// per-path proxy rules to maintain (a missing /history or /admin rule is exactly
// what makes Tasks & Results fail with "unexpected response HTTP 200"). The API
// routes above always take precedence; anything else falls back to index.html.
const API_PREFIX_RE = /^\/(auth|verify|bounce|history|admin|health)(\/|$)/;
const DIST_DIR = require('path').join(__dirname, 'frontend', 'dist');
if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    app.use((req, res, next) => {
        if (req.method !== 'GET' || API_PREFIX_RE.test(req.path)) return next();
        res.sendFile(require('path').join(DIST_DIR, 'index.html'));
    });
    console.log('[Web] Serving frontend from frontend/dist — you can proxy everything to this port.');
} else {
    console.log('[Web] frontend/dist not found — running API-only (serve the frontend separately).');
}

// Error handler — turns upload/multer and other errors into clean JSON responses
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
