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

// Editable profile fields, as camelCase (frontend/API) ↔ snake_case (SQLite).
const PROFILE_FIELDS = [
    ['firstName', 'first_name'], ['lastName', 'last_name'], ['phone', 'phone'],
    ['address', 'address'], ['city', 'city'], ['zip', 'zip'],
    ['country', 'country'], ['state', 'state'],
];

// Keep only known profile keys, coerce to trimmed strings (max 200 chars).
function cleanProfile(fields) {
    const out = {};
    for (const [camel] of PROFILE_FIELDS) {
        if (fields[camel] !== undefined && fields[camel] !== null) {
            out[camel] = String(fields[camel]).slice(0, 200);
        }
    }
    return out;
}

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
    // Modular FieldValue — the legacy `require('firebase-admin').firestore`
    // namespace is undefined in recent versions.
    const { FieldValue } = require('firebase-admin/firestore');
    const serverTimestamp = () => FieldValue.serverTimestamp();
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
            const d = doc.data();
            const view = { id: doc.id, email: d.email, credits: d.credits, role: d.role || 'user' };
            for (const [camel] of PROFILE_FIELDS) view[camel] = d[camel] || '';
            return view;
        },
        async getPasswordById(id) {
            const doc = await users.doc(String(id)).get();
            return doc.exists ? (doc.data().password ?? null) : null;
        },
        async updateProfile(id, fields) {
            const clean = cleanProfile(fields);
            if (Object.keys(clean).length === 0) return;
            await users.doc(String(id)).update(clean);
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
                    createdAt: serverTimestamp(),
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
            // Global, ever-unique task number via a shared counter doc (starts at 1001).
            const counterRef = fs.collection('meta').doc('counters');
            const batchNumber = await fs.runTransaction(async (tx) => {
                const csnap = await tx.get(counterRef);
                const seq = ((csnap.exists && csnap.data().batchSeq) || 1000) + 1;
                tx.set(counterRef, { batchSeq: seq }, { merge: true });
                tx.set(bref, {
                    batchNumber: seq, name: name || null, type,
                    total: s.total, valid: s.valid, invalid: s.invalid,
                    catchAll: s.catchAll, unknown: s.unknown, disposable: s.disposable,
                    results: stored,
                    createdAt: serverTimestamp(),
                });
                return seq;
            });
            return { id: bref.id, batchNumber, name: name || null, type, total: s.total, counts: countsFrom(s), createdAt: new Date().toISOString() };
        },
        async listBatches(userId, { type, limit }) {
            const col = users.doc(String(userId)).collection('batches');
            const cut = cutoffMs();
            // When filtering by type we use an equality-only query and sort in JS,
            // so Firestore needs only its automatic single-field indexes — no
            // manual composite (type + createdAt) index to create.
            let docs;
            if (type) {
                const snap = await col.where('type', '==', type).get();
                docs = snap.docs;
            } else {
                const snap = await col.orderBy('createdAt', 'desc').limit(limit).get();
                docs = snap.docs;
            }
            return docs
                .map(d => batchView(d, false))
                .filter(b => !b.createdAt || new Date(b.createdAt).getTime() >= cut)
                .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
                .slice(0, limit);
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
            // Walk each user's batches subcollection and delete expired ones. Using
            // per-user subcollection range queries (auto-indexed) avoids needing a
            // manual collection-group index on createdAt.
            const cut = new Date(cutoffMs());
            const usersSnap = await users.get();
            for (const u of usersSnap.docs) {
                const old = await u.ref.collection('batches').where('createdAt', '<', cut).limit(400).get();
                if (old.empty) continue;
                const batch = fs.batch();
                old.forEach(d => batch.delete(d.ref));
                await batch.commit();
            }
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
// Selector — Cloud Firestore only
// ===========================================================================

// This app stores ALL data in Cloud Firestore. A Firebase service account must
// be configured (see FIRESTORE-SETUP.md); there is no local-database fallback.
if (!isFirestoreEnabled()) {
    console.error('\n[FATAL] Cloud Firestore is required but not configured.');
    console.error('  Add a Firebase service account and try again:');
    console.error('    1. Put serviceAccount.json in the project root, OR set');
    console.error('       FIREBASE_SERVICE_ACCOUNT / GOOGLE_APPLICATION_CREDENTIALS');
    console.error('    2. Create the Firestore database in the Firebase console');
    console.error('  See FIRESTORE-SETUP.md for step-by-step instructions.\n');
    process.exit(1);
}

const impl = firestoreStore();

module.exports = {
    ...impl,
    backend: 'firestore',
    HISTORY_RETENTION_DAYS,
    summarize,
};
