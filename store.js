// Hybrid data store — Cloud Firestore when USE_FIRESTORE=1 (and a Firebase
// service account is configured), otherwise local SQLite. Both back-ends expose
// the exact same async interface, so server.js never needs to know which one is
// active.
//
// What is stored:
//   • users            — credentials (bcrypt hash), credits, role, created_at
//   • password_resets  — hashed, single-use reset tokens (SQLite path only)
//   • batches (history)— one document per verification execution, tagged with a
//                        per-user sequential batch number, retained ~1 month.
//
// Firestore layout:
//   users/{emailLower}                         -> user document (id = lowercased email)
//   users/{emailLower}/batches/{autoId}        -> one execution batch
//   password_resets/{tokenHash}                -> reset token

const db = require('./db');
const { isFirestoreEnabled, getFirestore } = require('./firebaseAdmin');

const HISTORY_RETENTION_DAYS = 30;
const HISTORY_MAX_STORED_RESULTS = 5000;   // cap stored payload per execution
const FIRESTORE_MAX_DOC_BYTES = 900 * 1024; // stay safely under Firestore's 1 MB doc limit

// --- Shared helpers ---

// Roll a list of per-address results up into batch counts. `invalid` counts
// every invalid address (disposable ones included); `disposable` is tracked
// separately so the dashboard can show it as its own slice.
function summarize(results) {
    const s = { total: results.length, valid: 0, invalid: 0, catchAll: 0, unknown: 0, disposable: 0 };
    for (const r of results) {
        if (r && r.disposable) s.disposable++;
        if (r && r.status === 'valid') s.valid++;
        else if (r && r.status === 'invalid') s.invalid++;
        else if (r && r.status === 'catch-all') s.catchAll++;
        else s.unknown++;
    }
    return s;
}

const countsFrom = (s) => ({ valid: s.valid, invalid: s.invalid, catchAll: s.catchAll, unknown: s.unknown, disposable: s.disposable });

// ===========================================================================
// SQLite implementation
// ===========================================================================

const sql = {
    get: (q, p = []) => new Promise((res, rej) => db.get(q, p, (e, row) => e ? rej(e) : res(row || null))),
    all: (q, p = []) => new Promise((res, rej) => db.all(q, p, (e, rows) => e ? rej(e) : res(rows || []))),
    run: (q, p = []) => new Promise((res, rej) => db.run(q, p, function (e) { e ? rej(e) : res(this); })),
};

const sqliteStore = {
    async findUserByEmail(email) {
        return sql.get(`SELECT * FROM users WHERE lower(email) = lower(?)`, [email]);
    },
    async getUserById(id) {
        return sql.get(`SELECT id, email, credits, role FROM users WHERE id = ?`, [id]);
    },
    async getRoleById(id) {
        const row = await sql.get(`SELECT role FROM users WHERE id = ?`, [id]);
        return row ? row.role : null;
    },
    async countUsers() {
        const row = await sql.get(`SELECT COUNT(*) AS n FROM users`, []);
        return row ? row.n : 0;
    },
    async createUser({ email, password, credits, role }) {
        try {
            const r = await sql.run(
                `INSERT INTO users (email, password, credits, role) VALUES (?, ?, ?, ?)`,
                [email, password ?? null, credits, role]
            );
            return { id: r.lastID, email, credits, role };
        } catch (e) {
            if (String(e.message).includes('UNIQUE constraint failed')) {
                const err = new Error('Email already exists'); err.code = 'EMAIL_EXISTS'; throw err;
            }
            throw e;
        }
    },
    async setPassword(id, hash) {
        await sql.run(`UPDATE users SET password = ? WHERE id = ?`, [hash, id]);
    },
    async setRole(id, role) {
        const r = await sql.run(`UPDATE users SET role = ? WHERE id = ?`, [role, id]);
        return r.changes;
    },
    async adjustCredits(id, delta) {
        await sql.run(`UPDATE users SET credits = MAX(credits + ?, 0) WHERE id = ?`, [delta, id]);
        const row = await sql.get(`SELECT credits FROM users WHERE id = ?`, [id]);
        return row ? row.credits : null;
    },
    async deductCredits(id, amount) {
        await sql.run(`UPDATE users SET credits = MAX(credits - ?, 0) WHERE id = ?`, [amount, id]);
    },
    async deleteUser(id) {
        const r = await sql.run(`DELETE FROM users WHERE id = ?`, [id]);
        await sql.run(`DELETE FROM history WHERE user_id = ?`, [id]);
        return r.changes;
    },
    async promoteByEmail(email, role, { skipIfSuperadmin = false } = {}) {
        const guard = skipIfSuperadmin ? ` AND role != 'superadmin'` : '';
        const r = await sql.run(`UPDATE users SET role = ? WHERE lower(email) = lower(?)${guard}`, [role, email]);
        return r.changes;
    },
    async listUsers({ hideSuper }) {
        const where = hideSuper ? `WHERE u.role != 'superadmin'` : '';
        return sql.all(
            `SELECT u.id, u.email, u.credits, u.role, u.created_at,
                    COALESCE(SUM(h.total), 0) AS emails_verified,
                    COUNT(h.id) AS executions
             FROM users u
             LEFT JOIN history h ON h.user_id = u.id
             ${where}
             GROUP BY u.id
             ORDER BY u.id ASC`, []
        );
    },

    // Password resets
    async createReset(userId, tokenHash, expiresAt) {
        await sql.run(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
            [userId, tokenHash, expiresAt]);
    },
    async getActiveReset(tokenHash) {
        return sql.get(`SELECT * FROM password_resets WHERE token_hash = ? AND used = 0`, [tokenHash]);
    },
    async consumeUserResets(userId) {
        await sql.run(`UPDATE password_resets SET used = 1 WHERE user_id = ?`, [userId]);
    },

    // Batches
    async createBatch(userId, { type, name, results }) {
        const s = summarize(results);
        const stored = JSON.stringify(results.slice(0, HISTORY_MAX_STORED_RESULTS));
        const r = await sql.run(
            `INSERT INTO history
                (user_id, batch_number, name, type, total, valid_count, invalid_count,
                 catch_all_count, unknown_count, disposable_count, results)
             VALUES (?,
                (SELECT COALESCE(MAX(batch_number),0)+1 FROM history WHERE user_id = ?),
                ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, userId, name || null, type, s.total, s.valid, s.invalid, s.catchAll, s.unknown, s.disposable, stored]
        );
        const row = await sql.get(`SELECT batch_number, created_at FROM history WHERE id = ?`, [r.lastID]);
        return {
            id: r.lastID,
            batchNumber: row ? row.batch_number : null,
            name: name || null,
            type,
            total: s.total,
            counts: countsFrom(s),
            createdAt: row ? row.created_at : null,
        };
    },
    async listBatches(userId, { type, limit }) {
        const params = [userId, `-${HISTORY_RETENTION_DAYS} days`];
        let q = `SELECT id, batch_number, name, type, total, valid_count, invalid_count,
                        catch_all_count, unknown_count, disposable_count, created_at
                 FROM history
                 WHERE user_id = ? AND created_at >= datetime('now', ?)`;
        if (type) { q += ` AND type = ?`; params.push(type); }
        q += ` ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`;
        params.push(limit);
        const rows = await sql.all(q, params);
        return rows.map(r => ({
            id: r.id,
            batchNumber: r.batch_number,
            name: r.name,
            type: r.type,
            total: r.total,
            counts: { valid: r.valid_count, invalid: r.invalid_count, catchAll: r.catch_all_count, unknown: r.unknown_count, disposable: r.disposable_count },
            createdAt: r.created_at,
        }));
    },
    async getBatch(userId, id) {
        const r = await sql.get(
            `SELECT id, batch_number, name, type, total, valid_count, invalid_count,
                    catch_all_count, unknown_count, disposable_count, results, created_at
             FROM history WHERE id = ? AND user_id = ?`, [id, userId]
        );
        if (!r) return null;
        let results = [];
        try { results = JSON.parse(r.results) || []; } catch { results = []; }
        return {
            id: r.id,
            batchNumber: r.batch_number,
            name: r.name,
            type: r.type,
            total: r.total,
            counts: { valid: r.valid_count, invalid: r.invalid_count, catchAll: r.catch_all_count, unknown: r.unknown_count, disposable: r.disposable_count },
            results,
            createdAt: r.created_at,
        };
    },
    async userStats(userId) {
        const row = await sql.get(
            `SELECT COUNT(*) AS executions,
                    COALESCE(SUM(total),0) AS total_emails,
                    COALESCE(SUM(valid_count),0) AS valid,
                    COALESCE(SUM(invalid_count),0) AS invalid,
                    COALESCE(SUM(catch_all_count),0) AS catch_all,
                    COALESCE(SUM(unknown_count),0) AS unknown,
                    COALESCE(SUM(disposable_count),0) AS disposable,
                    COALESCE(SUM(CASE WHEN type='csv' THEN 1 ELSE 0 END),0) AS lists_cleaned
             FROM history
             WHERE user_id = ? AND created_at >= datetime('now', ?)`,
            [userId, `-${HISTORY_RETENTION_DAYS} days`]
        );
        return {
            executions: row.executions,
            totalEmails: row.total_emails,
            listsCleaned: row.lists_cleaned,
            counts: { valid: row.valid, invalid: row.invalid, catchAll: row.catch_all, unknown: row.unknown, disposable: row.disposable },
        };
    },
    async cleanupOldBatches() {
        await sql.run(`DELETE FROM history WHERE created_at < datetime('now', ?)`, [`-${HISTORY_RETENTION_DAYS} days`]);
    },
    async adminStats({ viewerRole }) {
        const superFilter = viewerRole === 'superadmin' ? '' : `WHERE role != 'superadmin'`;
        return sql.get(
            `SELECT
                (SELECT COUNT(*) FROM users ${superFilter}) AS total_users,
                (SELECT COUNT(*) FROM users WHERE role = 'admin') AS admins,
                (SELECT COUNT(*) FROM users WHERE role = 'superadmin') AS superadmins,
                (SELECT COALESCE(SUM(credits),0) FROM users ${superFilter}) AS total_credits,
                (SELECT COUNT(*) FROM history) AS total_executions,
                (SELECT COALESCE(SUM(total),0) FROM history) AS total_emails,
                (SELECT COALESCE(SUM(valid_count),0) FROM history) AS total_valid`,
            []
        );
    },
};

// ===========================================================================
// Firestore implementation
// ===========================================================================

// Cap a results array so the serialized batch document stays under Firestore's
// per-document size limit. Returns the largest prefix that fits.
function fitResults(results) {
    let arr = results.slice(0, HISTORY_MAX_STORED_RESULTS);
    while (arr.length > 0 && Buffer.byteLength(JSON.stringify(arr), 'utf8') > FIRESTORE_MAX_DOC_BYTES) {
        arr = arr.slice(0, Math.floor(arr.length * 0.8));
    }
    return arr;
}

const toIso = (ts) => (ts && typeof ts.toDate === 'function') ? ts.toDate().toISOString() : (ts || null);
const cutoffMs = () => Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function firestoreStore() {
    const fs = getFirestore();
    const users = fs.collection('users');
    const resets = fs.collection('password_resets');
    const uid = (email) => String(email).trim().toLowerCase();

    const userView = (doc) => {
        const d = doc.data();
        return { id: doc.id, email: d.email, credits: d.credits, role: d.role || 'user',
                 password: d.password ?? null, created_at: toIso(d.createdAt) };
    };
    const batchView = (doc, withResults) => {
        const d = doc.data();
        const view = {
            id: doc.id,
            batchNumber: d.batchNumber ?? null,
            name: d.name ?? null,
            type: d.type,
            total: d.total || 0,
            counts: { valid: d.valid || 0, invalid: d.invalid || 0, catchAll: d.catchAll || 0, unknown: d.unknown || 0, disposable: d.disposable || 0 },
            createdAt: toIso(d.createdAt),
        };
        if (withResults) {
            try { view.results = d.results ? JSON.parse(d.results) : []; } catch { view.results = []; }
        }
        return view;
    };

    return {
        async findUserByEmail(email) {
            const doc = await users.doc(uid(email)).get();
            return doc.exists ? userView(doc) : null;
        },
        async getUserById(id) {
            const doc = await users.doc(String(id)).get();
            if (!doc.exists) return null;
            const v = userView(doc);
            return { id: v.id, email: v.email, credits: v.credits, role: v.role };
        },
        async getRoleById(id) {
            const doc = await users.doc(String(id)).get();
            return doc.exists ? (doc.data().role || 'user') : null;
        },
        async countUsers() {
            const snap = await users.count().get();
            return snap.data().count;
        },
        async createUser({ email, password, credits, role }) {
            const ref = users.doc(uid(email));
            const created = await fs.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                if (snap.exists) { const err = new Error('Email already exists'); err.code = 'EMAIL_EXISTS'; throw err; }
                tx.set(ref, {
                    email, emailLower: uid(email), password: password ?? null,
                    credits, role, batchSeq: 0,
                    createdAt: require('firebase-admin').firestore.FieldValue.serverTimestamp(),
                });
                return true;
            });
            return created ? { id: ref.id, email, credits, role } : null;
        },
        async setPassword(id, hash) {
            await users.doc(String(id)).update({ password: hash });
        },
        async setRole(id, role) {
            const ref = users.doc(String(id));
            const snap = await ref.get();
            if (!snap.exists) return 0;
            await ref.update({ role });
            return 1;
        },
        async adjustCredits(id, delta) {
            const ref = users.doc(String(id));
            return fs.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                if (!snap.exists) return null;
                const credits = Math.max((snap.data().credits || 0) + delta, 0);
                tx.update(ref, { credits });
                return credits;
            });
        },
        async deductCredits(id, amount) {
            const ref = users.doc(String(id));
            await fs.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                if (!snap.exists) return;
                const credits = Math.max((snap.data().credits || 0) - amount, 0);
                tx.update(ref, { credits });
            });
        },
        async deleteUser(id) {
            const ref = users.doc(String(id));
            const snap = await ref.get();
            if (!snap.exists) return 0;
            // Delete the user's batches, then the user document.
            const batches = await ref.collection('batches').get();
            const chunks = [];
            let batch = fs.batch(); let n = 0;
            for (const d of batches.docs) {
                batch.delete(d.ref); n++;
                if (n === 400) { chunks.push(batch.commit()); batch = fs.batch(); n = 0; }
            }
            chunks.push(batch.commit());
            await Promise.all(chunks);
            await ref.delete();
            return 1;
        },
        async promoteByEmail(email, role, { skipIfSuperadmin = false } = {}) {
            const ref = users.doc(uid(email));
            const snap = await ref.get();
            if (!snap.exists) return 0;
            if (skipIfSuperadmin && snap.data().role === 'superadmin') return 0;
            await ref.update({ role });
            return 1;
        },
        async listUsers({ hideSuper }) {
            const snap = await users.orderBy('createdAt', 'asc').get();
            const out = [];
            for (const doc of snap.docs) {
                const d = doc.data();
                if (hideSuper && d.role === 'superadmin') continue;
                // Aggregate this user's batches (created_at within retention window
                // isn't enforced here so admin totals reflect lifetime usage).
                const bSnap = await doc.ref.collection('batches').select('total').get();
                let emails_verified = 0;
                bSnap.forEach(b => { emails_verified += (b.data().total || 0); });
                out.push({
                    id: doc.id, email: d.email, credits: d.credits, role: d.role || 'user',
                    created_at: toIso(d.createdAt), emails_verified, executions: bSnap.size,
                });
            }
            return out;
        },

        // Password resets (Firestore path)
        async createReset(userId, tokenHash, expiresAt) {
            await resets.doc(tokenHash).set({ userId: String(userId), tokenHash, expiresAt, used: false });
        },
        async getActiveReset(tokenHash) {
            const doc = await resets.doc(tokenHash).get();
            if (!doc.exists) return null;
            const d = doc.data();
            if (d.used) return null;
            return { user_id: d.userId, token_hash: d.tokenHash, expires_at: d.expiresAt, used: 0 };
        },
        async consumeUserResets(userId) {
            const snap = await resets.where('userId', '==', String(userId)).get();
            const batch = fs.batch();
            snap.forEach(d => batch.update(d.ref, { used: true }));
            await batch.commit();
        },

        // Batches
        async createBatch(userId, { type, name, results }) {
            const uref = users.doc(String(userId));
            const bref = uref.collection('batches').doc();
            const s = summarize(results);
            const stored = JSON.stringify(fitResults(results));
            const admin = require('firebase-admin');
            const batchNumber = await fs.runTransaction(async (tx) => {
                const usnap = await tx.get(uref);
                const seq = ((usnap.exists && usnap.data().batchSeq) || 0) + 1;
                tx.update(uref, { batchSeq: seq });
                tx.set(bref, {
                    batchNumber: seq, name: name || null, type,
                    total: s.total, valid: s.valid, invalid: s.invalid,
                    catchAll: s.catchAll, unknown: s.unknown, disposable: s.disposable,
                    results: stored,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });
                return seq;
            });
            return { id: bref.id, batchNumber, name: name || null, type, total: s.total, counts: countsFrom(s), createdAt: new Date().toISOString() };
        },
        async listBatches(userId, { type, limit }) {
            let q = users.doc(String(userId)).collection('batches').orderBy('createdAt', 'desc');
            if (type) q = q.where('type', '==', type);
            const snap = await q.limit(limit).get();
            const cut = cutoffMs();
            return snap.docs
                .map(d => batchView(d, false))
                .filter(b => !b.createdAt || new Date(b.createdAt).getTime() >= cut);
        },
        async getBatch(userId, id) {
            const doc = await users.doc(String(userId)).collection('batches').doc(String(id)).get();
            return doc.exists ? batchView(doc, true) : null;
        },
        async userStats(userId) {
            const cut = cutoffMs();
            const snap = await users.doc(String(userId)).collection('batches')
                .orderBy('createdAt', 'desc').limit(2000).get();
            const st = { executions: 0, totalEmails: 0, listsCleaned: 0,
                         counts: { valid: 0, invalid: 0, catchAll: 0, unknown: 0, disposable: 0 } };
            snap.forEach(doc => {
                const d = doc.data();
                if (d.createdAt && d.createdAt.toDate && d.createdAt.toDate().getTime() < cut) return;
                st.executions++;
                st.totalEmails += d.total || 0;
                if (d.type === 'csv') st.listsCleaned++;
                st.counts.valid += d.valid || 0;
                st.counts.invalid += d.invalid || 0;
                st.counts.catchAll += d.catchAll || 0;
                st.counts.unknown += d.unknown || 0;
                st.counts.disposable += d.disposable || 0;
            });
            return st;
        },
        async cleanupOldBatches() {
            const cut = new Date(cutoffMs());
            const snap = await fs.collectionGroup('batches')
                .where('createdAt', '<', cut).limit(400).get();
            if (snap.empty) return;
            const batch = fs.batch();
            snap.forEach(d => batch.delete(d.ref));
            await batch.commit();
        },
        async adminStats({ viewerRole }) {
            const snap = await users.get();
            let total_users = 0, admins = 0, superadmins = 0, total_credits = 0;
            const uids = [];
            snap.forEach(doc => {
                const d = doc.data();
                const role = d.role || 'user';
                if (role === 'admin') admins++;
                if (role === 'superadmin') superadmins++;
                if (viewerRole === 'superadmin' || role !== 'superadmin') {
                    total_users++;
                    total_credits += d.credits || 0;
                }
                uids.push(doc.ref);
            });
            let total_executions = 0, total_emails = 0, total_valid = 0;
            for (const uref of uids) {
                const bSnap = await uref.collection('batches').select('total', 'valid').get();
                total_executions += bSnap.size;
                bSnap.forEach(b => { total_emails += b.data().total || 0; total_valid += b.data().valid || 0; });
            }
            return { total_users, admins, superadmins, total_credits, total_executions, total_emails, total_valid };
        },
    };
}

// ===========================================================================
// Selector
// ===========================================================================

const usingFirestore = isFirestoreEnabled();
const impl = usingFirestore ? firestoreStore() : sqliteStore;

module.exports = {
    ...impl,
    backend: usingFirestore ? 'firestore' : 'sqlite',
    HISTORY_RETENTION_DAYS,
    summarize,
};
