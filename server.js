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
const db = require('./db');

const app = express();

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
    res.json({ status: 'ok' });
});

// --- Auth Endpoints ---

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The email that should be treated as the super admin. Set ADMIN_EMAIL in the
// environment; that account (existing or newly registered) becomes admin.
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();

// Promote the configured admin email on startup (works for already-registered
// accounts too).
if (ADMIN_EMAIL) {
    db.run(`UPDATE users SET role = 'admin' WHERE lower(email) = ?`, [ADMIN_EMAIL], function (err) {
        if (!err && this.changes > 0) console.log(`[Admin] ${ADMIN_EMAIL} promoted to admin.`);
    });
}

app.post('/auth/register', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Invalid input' });
    }
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address' });
    if (password.length < 8 || password.length > 200) {
        return res.status(400).json({ error: 'Password must be between 8 and 200 characters' });
    }

    bcrypt.hash(password, 10, (err, hash) => {
        if (err) return res.status(500).json({ error: 'Server error' });

        // First-ever user, or the configured ADMIN_EMAIL, becomes the admin.
        db.get(`SELECT COUNT(*) AS n FROM users`, [], (cErr, row) => {
            const isFirst = !cErr && row && row.n === 0;
            const role = (isFirst || email.toLowerCase() === ADMIN_EMAIL) ? 'admin' : 'user';

            db.run(`INSERT INTO users (email, password, credits, role) VALUES (?, ?, 100, ?)`, [email, hash, role], function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: 'Email already exists' });
                    }
                    return res.status(500).json({ error: 'Database error' });
                }
                res.json({ success: true, message: 'User registered successfully', userId: this.lastID, role });
            });
        });
    });
});

app.post('/auth/login', (req, res) => {
    const { email, password } = req.body;

    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!user) return res.status(400).json({ error: 'Invalid email or password' });
        if (!user.password) return res.status(400).json({ error: 'This account uses Google sign-in. Continue with Google.' });

        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err) return res.status(500).json({ error: 'Server error' });
            if (!isMatch) return res.status(400).json({ error: 'Invalid email or password' });

            const token = jwt.sign({ id: user.id, email: user.email, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '24h' });
            res.json({ token, user: { id: user.id, email: user.email, credits: user.credits, role: user.role || 'user' } });
        });
    });
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

    db.get(`SELECT * FROM users WHERE lower(email) = ?`, [email], (err, user) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (user) return issue(user);

        // First-ever user, or the configured ADMIN_EMAIL, becomes the admin.
        db.get(`SELECT COUNT(*) AS n FROM users`, [], (cErr, row) => {
            const isFirst = !cErr && row && row.n === 0;
            const role = (isFirst || email === ADMIN_EMAIL) ? 'admin' : 'user';
            db.run(`INSERT INTO users (email, password, credits, role) VALUES (?, NULL, 100, ?)`, [email, role], function (insErr) {
                if (insErr) {
                    if (insErr.message.includes('UNIQUE constraint failed')) {
                        return db.get(`SELECT * FROM users WHERE lower(email) = ?`, [email], (e2, u2) => u2 ? issue(u2) : res.status(500).json({ error: 'Database error' }));
                    }
                    return res.status(500).json({ error: 'Database error' });
                }
                issue({ id: this.lastID, email, credits: 100, role });
            });
        });
    });
});

// Front-end origin used to build the reset link in the email.
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Single place that "sends" the reset email. Wire your email provider here
// (nodemailer/SendGrid/etc). Until then, in non-production we log the link so
// you can test the flow locally.
function deliverResetEmail(email, link) {
    if (process.env.NODE_ENV === 'production') {
        // TODO: integrate a real email provider here.
        console.log(`[Reset] (production) reset link generated for ${email} — wire an email provider in deliverResetEmail().`);
    } else {
        console.log(`\n[Reset] Password-reset link for ${email}:\n  ${link}\n`);
    }
}

// Request a password reset. Always responds success (no account enumeration).
app.post('/auth/forgot-password', (req, res) => {
    const email = (req.body && req.body.email || '').trim().toLowerCase();
    const ok = () => res.json({ success: true });
    if (!email || !EMAIL_RE.test(email)) return ok();

    db.get(`SELECT * FROM users WHERE lower(email) = ?`, [email], (err, user) => {
        // Only send for real accounts that use a password (not Google-only).
        if (err || !user || !user.password) return ok();

        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = sha256(token);
        const expiresAt = Date.now() + RESET_TTL_MS;

        db.run(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
            [user.id, tokenHash, expiresAt], (insErr) => {
                if (!insErr) {
                    deliverResetEmail(user.email, `${FRONTEND_URL}/reset-password?token=${token}`);
                }
                return ok(); // respond success either way
            });
    });
});

// Complete a password reset using the emailed token.
app.post('/auth/reset-password', (req, res) => {
    const { token, password } = req.body || {};
    if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Invalid reset link' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
        return res.status(400).json({ error: 'Password must be between 8 and 200 characters' });
    }

    const tokenHash = sha256(token);
    db.get(`SELECT * FROM password_resets WHERE token_hash = ? AND used = 0`, [tokenHash], (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!row || row.expires_at < Date.now()) {
            return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
        }

        bcrypt.hash(password, 10, (hErr, hash) => {
            if (hErr) return res.status(500).json({ error: 'Server error' });
            db.run(`UPDATE users SET password = ? WHERE id = ?`, [hash, row.user_id], (uErr) => {
                if (uErr) return res.status(500).json({ error: 'Database error' });
                // Consume this token and invalidate any other outstanding ones.
                db.run(`UPDATE password_resets SET used = 1 WHERE user_id = ?`, [row.user_id]);
                res.json({ success: true });
            });
        });
    });
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

app.get('/auth/me', authenticateToken, (req, res) => {
    db.get(`SELECT id, email, credits, role FROM users WHERE id = ?`, [req.user.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    });
});

// Admin-only guard — verifies the current user still has the admin role.
function requireAdmin(req, res, next) {
    db.get(`SELECT role FROM users WHERE id = ?`, [req.user.id], (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!row || row.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
        next();
    });
}

function getUser(userId) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT id, email, credits FROM users WHERE id = ?`, [userId], (err, user) => {
            if (err) reject(err);
            else resolve(user);
        });
    });
}

function deductCredits(userId, amount) {
    return new Promise((resolve, reject) => {
        // Guard against credits going negative.
        db.run(`UPDATE users SET credits = MAX(credits - ?, 0) WHERE id = ?`, [amount, userId], function(err) {
            if (err) reject(err);
            else resolve();
        });
    });
}

// --- Verification history (retained ~1 month) ---

const HISTORY_RETENTION_DAYS = 30;
const HISTORY_MAX_STORED_RESULTS = 5000; // cap stored payload per execution

function summarizeResults(results) {
    const summary = { total: results.length, valid: 0, invalid: 0, catchAll: 0, unknown: 0 };
    for (const r of results) {
        if (r.status === 'valid') summary.valid++;
        else if (r.status === 'invalid') summary.invalid++;
        else if (r.status === 'catch-all') summary.catchAll++;
        else summary.unknown++;
    }
    return summary;
}

function saveHistory(userId, type, results) {
    return new Promise((resolve) => {
        const s = summarizeResults(results);
        const stored = results.slice(0, HISTORY_MAX_STORED_RESULTS);
        db.run(
            `INSERT INTO history
                (user_id, type, total, valid_count, invalid_count, catch_all_count, unknown_count, results)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, type, s.total, s.valid, s.invalid, s.catchAll, s.unknown, JSON.stringify(stored)],
            (err) => {
                if (err) console.error('Failed to save history:', err.message);
                resolve(); // history is best-effort; never fail the request over it
            }
        );
    });
}

function cleanupHistory() {
    db.run(
        `DELETE FROM history WHERE created_at < datetime('now', ?)`,
        [`-${HISTORY_RETENTION_DAYS} days`],
        (err) => { if (err) console.error('History cleanup error:', err.message); }
    );
}
// Purge expired history at startup and periodically thereafter.
cleanupHistory();
setInterval(cleanupHistory, 6 * 60 * 60 * 1000);

// --- Verification Endpoints (Protected) ---

app.post('/verify', authenticateToken, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const user = await getUser(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.credits < 1) return res.status(402).json({ error: 'Insufficient credits' });

        const result = await verifyEmail(email);
        await deductCredits(req.user.id, 1);
        await saveHistory(req.user.id, 'single', [result]);

        res.json(result);
    } catch (err) {
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
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
        return res.status(400).json({ error: 'Array of emails is required' });
    }

    try {
        const user = await getUser(req.user.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.credits < emails.length) {
            return res.status(402).json({ error: `Insufficient credits: need ${emails.length}, have ${user.credits}` });
        }

        const results = await asyncPool(5, emails, async (email) => {
            return await verifyEmail(email);
        });

        await deductCredits(req.user.id, results.length);
        await saveHistory(req.user.id, 'bulk', results);
        res.json({ total: results.length, results });
    } catch (err) {
        res.status(500).json({ error: 'Bulk verification failed' });
    }
});

app.post('/verify/csv', authenticateToken, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });

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
                const user = await getUser(req.user.id);
                if (!user) return res.status(404).json({ error: 'User not found' });
                if (user.credits < emails.length) {
                    return res.status(402).json({ error: `Insufficient credits: need ${emails.length}, have ${user.credits}` });
                }

                const results = await asyncPool(5, emails, async (email) => {
                    return await verifyEmail(email);
                });

                await deductCredits(req.user.id, results.length);
                await saveHistory(req.user.id, 'csv', results);
                res.json({ total: results.length, results });
            } catch (err) {
                res.status(500).json({ error: 'CSV verification failed' });
            }
        })
        .on('error', (err) => {
            fs.unlink(req.file.path, () => {});
            res.status(500).json({ error: 'Failed to parse CSV' });
        });
});

// --- History Endpoints (Protected) ---

// List past executions for the logged-in user within the retention window.
// Optional query: ?type=single|bulk|csv  &  ?limit=N (default 50, max 200)
app.get('/history', authenticateToken, (req, res) => {
    const { type } = req.query;
    let limit = parseInt(req.query.limit, 10);
    if (Number.isNaN(limit) || limit < 1) limit = 50;
    if (limit > 200) limit = 200;

    const params = [req.user.id, `-${HISTORY_RETENTION_DAYS} days`];
    let sql = `SELECT id, type, total, valid_count, invalid_count, catch_all_count,
                      unknown_count, results, created_at
               FROM history
               WHERE user_id = ? AND created_at >= datetime('now', ?)`;
    if (type && ['single', 'bulk', 'csv'].includes(type)) {
        sql += ` AND type = ?`;
        params.push(type);
    }
    sql += ` ORDER BY datetime(created_at) DESC LIMIT ?`;
    params.push(limit);

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to load history' });
        const history = rows.map(r => ({
            id: r.id,
            type: r.type,
            total: r.total,
            counts: {
                valid: r.valid_count,
                invalid: r.invalid_count,
                catchAll: r.catch_all_count,
                unknown: r.unknown_count
            },
            results: safeParse(r.results),
            createdAt: r.created_at
        }));
        res.json({ retentionDays: HISTORY_RETENTION_DAYS, history });
    });
});

// Aggregate stats for the dashboard (within the retention window).
app.get('/history/stats', authenticateToken, (req, res) => {
    const params = [req.user.id, `-${HISTORY_RETENTION_DAYS} days`];
    const sql = `SELECT
            COUNT(*) AS executions,
            COALESCE(SUM(total), 0) AS total_emails,
            COALESCE(SUM(valid_count), 0) AS valid,
            COALESCE(SUM(invalid_count), 0) AS invalid,
            COALESCE(SUM(catch_all_count), 0) AS catch_all,
            COALESCE(SUM(unknown_count), 0) AS unknown,
            COALESCE(SUM(CASE WHEN type = 'csv' THEN 1 ELSE 0 END), 0) AS lists_cleaned
        FROM history
        WHERE user_id = ? AND created_at >= datetime('now', ?)`;
    db.get(sql, params, (err, row) => {
        if (err) return res.status(500).json({ error: 'Failed to load stats' });
        res.json({
            retentionDays: HISTORY_RETENTION_DAYS,
            executions: row.executions,
            totalEmails: row.total_emails,
            listsCleaned: row.lists_cleaned,
            counts: {
                valid: row.valid,
                invalid: row.invalid,
                catchAll: row.catch_all,
                unknown: row.unknown
            }
        });
    });
});

function safeParse(json) {
    try { return JSON.parse(json) || []; } catch (e) { return []; }
}

// --- Admin Endpoints (Protected, admin only) ---

// List all users with their verification counts.
app.get('/admin/users', authenticateToken, requireAdmin, (req, res) => {
    const sql = `SELECT u.id, u.email, u.credits, u.role, u.created_at,
                        COALESCE(SUM(h.total), 0) AS emails_verified,
                        COUNT(h.id) AS executions
                 FROM users u
                 LEFT JOIN history h ON h.user_id = u.id
                 GROUP BY u.id
                 ORDER BY u.id ASC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Failed to load users' });
        res.json({ users: rows });
    });
});

// Platform-wide stats.
app.get('/admin/stats', authenticateToken, requireAdmin, (req, res) => {
    db.get(`SELECT
                (SELECT COUNT(*) FROM users) AS total_users,
                (SELECT COUNT(*) FROM users WHERE role = 'admin') AS admins,
                (SELECT COALESCE(SUM(credits),0) FROM users) AS total_credits,
                (SELECT COUNT(*) FROM history) AS total_executions,
                (SELECT COALESCE(SUM(total),0) FROM history) AS total_emails,
                (SELECT COALESCE(SUM(valid_count),0) FROM history) AS total_valid`,
        [], (err, row) => {
            if (err) return res.status(500).json({ error: 'Failed to load stats' });
            res.json(row);
        });
});

// Adjust a user's credits by a (positive or negative) delta.
app.post('/admin/users/:id/credits', authenticateToken, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const delta = parseInt(req.body.delta, 10);
    if (Number.isNaN(id) || Number.isNaN(delta)) return res.status(400).json({ error: 'Invalid input' });
    db.run(`UPDATE users SET credits = MAX(credits + ?, 0) WHERE id = ?`, [delta, id], function (err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
        db.get(`SELECT credits FROM users WHERE id = ?`, [id], (e, row) => {
            res.json({ success: true, credits: row ? row.credits : null });
        });
    });
});

// Change a user's role ('user' | 'admin').
app.post('/admin/users/:id/role', authenticateToken, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const role = req.body.role;
    if (Number.isNaN(id) || !['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid input' });
    if (id === req.user.id && role !== 'admin') {
        return res.status(400).json({ error: 'You cannot remove your own admin role' });
    }
    db.run(`UPDATE users SET role = ? WHERE id = ?`, [role, id], function (err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, role });
    });
});

// Delete a user and their history.
app.delete('/admin/users/:id', authenticateToken, requireAdmin, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid input' });
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    db.run(`DELETE FROM users WHERE id = ?`, [id], function (err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
        db.run(`DELETE FROM history WHERE user_id = ?`, [id], () => {});
        res.json({ success: true });
    });
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
