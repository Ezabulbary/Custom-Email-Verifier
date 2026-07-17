const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { parse } = require('csv-parse');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { fetchDomains } = require('./disposable');
const { verifyEmail } = require('./verifier');
const db = require('./db');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-123';

// Load disposable domains at startup
fetchDomains().then(() => {
    console.log('Disposable domains loaded. Ready to verify.');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// --- Auth Endpoints ---

app.post('/auth/register', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    bcrypt.hash(password, 10, (err, hash) => {
        if (err) return res.status(500).json({ error: 'Server error' });
        
        db.run(`INSERT INTO users (email, password, credits) VALUES (?, ?, 100)`, [email, hash], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'Email already exists' });
                }
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ success: true, message: 'User registered successfully', userId: this.lastID });
        });
    });
});

app.post('/auth/login', (req, res) => {
    const { email, password } = req.body;
    
    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!user) return res.status(400).json({ error: 'Invalid email or password' });

        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err) return res.status(500).json({ error: 'Server error' });
            if (!isMatch) return res.status(400).json({ error: 'Invalid email or password' });

            const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
            res.json({ token, user: { id: user.id, email: user.email, credits: user.credits } });
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
    db.get(`SELECT id, email, credits FROM users WHERE id = ?`, [req.user.id], (err, user) => {
        if (err || !user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    });
});

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

// --- Admin Endpoints ---
app.get('/admin/users', authenticateToken, requireAdmin, (req, res) => {
    const search = req.query.search ? req.query.search.trim() : '';
    let query = `SELECT id, email, credits, role FROM users`;
    let params = [];
    if (search && search.length > 0) {
        query += ` WHERE email LIKE ?`;
        params.push(`%${search}%`);
    }
    query += ` ORDER BY id ASC`;
    db.all(query, params, (err, users) => {
        if (err) {
            console.error('Admin users DB error:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(users || []);
    });
});

app.post('/admin/users/:id/credits', authenticateToken, requireAdmin, (req, res) => {
    const { amount } = req.body;
    db.run(`UPDATE users SET credits = credits + ? WHERE id = ?`, [amount, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        db.run(`INSERT INTO transactions (user_id, type, amount) VALUES (?, 'admin_adjustment', ?)`, [req.params.id, amount]);
        res.json({ success: true });
    });
});

app.post('/admin/roles', authenticateToken, requireSuperAdmin, (req, res) => {
    const { userId, role } = req.body;
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    db.run(`UPDATE users SET role = ? WHERE id = ? AND role != 'super_admin'`, [role, userId], function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ success: true });
    });
});

// --- Stripe Endpoints ---
app.post('/api/checkout', authenticateToken, async (req, res) => {
    const { packageId } = req.body; // e.g., 'starter', 'pro'
    let amount = 0; let credits = 0;
    if (packageId === 'starter') { amount = 1000; credits = 5000; } // $10.00
    else if (packageId === 'pro') { amount = 5000; credits = 50000; } // $50.00
    else return res.status(400).json({ error: 'Invalid package' });

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: { currency: 'usd', product_data: { name: `${credits} Credits` }, unit_amount: amount },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${req.headers.origin || 'http://localhost:5173'}/dashboard?payment=success`,
            cancel_url: `${req.headers.origin || 'http://localhost:5173'}/dashboard?payment=cancelled`,
            client_reference_id: req.user.id.toString(),
            metadata: { credits: credits.toString() }
        });
        res.json({ url: session.url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Webhook for Stripe
app.post('/api/webhooks/stripe', (req, res) => {
    const event = req.body;
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const credits = parseInt(session.metadata.credits, 10);
        
        db.run(`UPDATE users SET credits = credits + ? WHERE id = ?`, [credits, userId], function(err) {
            if (!err) {
                db.run(`INSERT INTO transactions (user_id, type, amount, stripe_session_id) VALUES (?, 'purchase', ?, ?)`, 
                    [userId, credits, session.id]);
            }
        });
    }
    res.json({ received: true });
});
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Email Verifier API running on port ${PORT}`);
});
