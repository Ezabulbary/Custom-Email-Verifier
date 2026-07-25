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
const { parse } = require('csv-parse');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { fetchDomains } = require('./disposable');
const { verifyEmail } = require('./verifier');
const { isGoogleEnabled, verifyIdToken } = require('./firebaseAdmin');
const { isEmailEnabled, sendResetEmail } = require('./mailer');
const store = require('./store');

const app = express();

console.log(`[Store] Active data store: ${store.backend.toUpperCase()}`);

// Limit uploads: max 2 MB and only accept CSV files, to avoid disk/CPU DoS
// from arbitrarily large or non-CSV uploads.
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
        const isCsv = file.mimetype === 'text/csv'
            || file.mimetype === 'application/vnd.ms-excel'
            || /\.csv$/i.test(file.originalname);
        cb(isCsv ? null : new Error('Only CSV files are allowed'), isCsv);
    }
});

// Restrict CORS to configured origins in production; default to permissive only
// when no allow-list is set (development convenience).
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : {}));
app.use(express.json({ limit: '1mb' }));

// Never ship a hardcoded secret: require JWT_SECRET in production, and fall back
// to a random per-process secret (which invalidates tokens on restart) rather
// than a guessable default that would let anyone forge auth tokens.
const JWT_SECRET = process.env.JWT_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
        console.error('FATAL: JWT_SECRET must be set in production.');
        process.exit(1);
    }
    console.warn('[Security] JWT_SECRET not set — using a random ephemeral secret. Sessions reset on restart.');
    return crypto.randomBytes(48).toString('hex');
})();

// Load disposable domains at startup
fetchDomains().then(() => {
    console.log('Disposable domains loaded. Ready to verify.');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', store: store.backend });
});

// --- Auth Endpoints ---

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

app.post('/auth/register', async (req, res) => {
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

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Invalid email or password' });

    try {
        const user = await store.findUserByEmail(email);
        if (!user) return res.status(400).json({ error: 'Invalid email or password' });
        if (!user.password) return res.status(400).json({ error: 'This account uses Google sign-in. Continue with Google.' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'Invalid email or password' });

        const token = jwt.sign({ id: user.id, email: user.email, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, email: user.email, credits: user.credits, role: user.role || 'user' } });
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Database error' });
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
            console.error(`[Reset] Failed to send reset email to ${email}:`, e.message);
            // fall through to logging so a mail outage doesn't fully break resets
        }
    }
    if (process.env.NODE_ENV !== 'production') {
        console.log(`\n[Reset] Password-reset link for ${email}:\n  ${link}\n`);
    }
}

// Request a password reset. Always responds success (no account enumeration).
app.post('/auth/forgot-password', async (req, res) => {
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
        console.error('Failed to save batch:', err.message);
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

app.post('/verify', authenticateToken, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const user = await store.getUserById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.credits < 1) return res.status(402).json({ error: 'Insufficient credits' });

        const result = await verifyEmail(email);
        await store.deductCredits(req.user.id, 1);
        const batch = await saveBatch(req.user.id, 'single', [result], (req.body.name || '').toString().slice(0, 120) || null);

        res.json({ ...result, batchId: batch && batch.id, batchNumber: batch && batch.batchNumber });
    } catch (err) {
        console.error('Verify error:', err.message);
        res.status(500).json({ error: 'Verification failed' });
    }
});

async function asyncPool(poolLimit, array, iteratorFn) {
    const ret = [];
    const executing = [];
    for (const item of array) {
        const p = Promise.resolve().then(() => iteratorFn(item, array));
        ret.push(p);
        if (poolLimit <= array.length) {
            const e = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
            if (executing.length >= poolLimit) {
                await Promise.race(executing);
            }
        }
    }
    return Promise.all(ret);
}

app.post('/verify/bulk', authenticateToken, async (req, res) => {
    const { emails } = req.body;
    const name = (req.body.name || '').toString().slice(0, 120) || null;
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ error: 'Array of emails is required' });
    }

    try {
        const user = await store.getUserById(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.credits < emails.length) {
            return res.status(402).json({ error: `Insufficient credits: need ${emails.length}, have ${user.credits}` });
        }

        const results = await asyncPool(5, emails, async (email) => {
            return await verifyEmail(email);
        });

        await store.deductCredits(req.user.id, results.length);
        const batch = await saveBatch(req.user.id, 'bulk', results, name);
        res.json({ total: results.length, results, batchId: batch && batch.id, batchNumber: batch && batch.batchNumber });
    } catch (err) {
        console.error('Bulk verify error:', err.message);
        res.status(500).json({ error: 'Bulk verification failed' });
    }
});

app.post('/verify/csv', authenticateToken, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
    const name = (req.body.name || '').toString().slice(0, 120) || null;

    const emails = [];
    fs.createReadStream(req.file.path)
        .pipe(parse({ columns: true, skip_empty_lines: true }))
        .on('data', (row) => {
            const emailKey = Object.keys(row).find(k => k.toLowerCase().includes('email')) || Object.keys(row)[0];
            if (emailKey && row[emailKey]) {
                emails.push(row[emailKey].trim());
            }
        })
        .on('end', async () => {
            fs.unlink(req.file.path, () => {});

            if (emails.length === 0) {
                return res.status(400).json({ error: 'No emails found in CSV' });
            }

            try {
                const user = await store.getUserById(req.user.id);
                if (!user) return res.status(404).json({ error: 'User not found' });
                if (user.credits < emails.length) {
                    return res.status(402).json({ error: `Insufficient credits: need ${emails.length}, have ${user.credits}` });
                }

                const results = await asyncPool(5, emails, async (email) => {
                    return await verifyEmail(email);
                });

                await store.deductCredits(req.user.id, results.length);
                const batch = await saveBatch(req.user.id, 'csv', results, name);
                res.json({ total: results.length, results, batchId: batch && batch.id, batchNumber: batch && batch.batchNumber });
            } catch (err) {
                console.error('CSV verify error:', err.message);
                res.status(500).json({ error: 'CSV verification failed' });
            }
        })
        .on('error', (err) => {
            fs.unlink(req.file.path, () => {});
            res.status(500).json({ error: 'Failed to parse CSV' });
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

// Error handler — turns upload/multer and other errors into clean JSON responses
// instead of leaking stack traces via the default HTML error page.
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.message === 'Only CSV files are allowed') {
        return res.status(400).json({ error: err.message });
    }
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Email Verifier API running on port ${PORT}`);
});
