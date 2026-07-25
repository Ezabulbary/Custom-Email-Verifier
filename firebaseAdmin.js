// Optional Firebase Admin — used ONLY to verify Google sign-in ID tokens.
//
// It self-enables when a service account is provided, via either:
//   - FIREBASE_SERVICE_ACCOUNT       = the service-account JSON, stringified
//   - GOOGLE_APPLICATION_CREDENTIALS = path to the serviceAccount.json file
//
// If neither is set (or firebase-admin isn't installed), Google sign-in is
// simply disabled and the email/password flow keeps working unchanged.
let admin = null;
let enabled = false;

try {
    const firebaseAdmin = require('firebase-admin');
    let credential = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        credential = firebaseAdmin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        credential = firebaseAdmin.credential.applicationDefault();
    }

    if (credential) {
        firebaseAdmin.initializeApp({ credential });
        admin = firebaseAdmin;
        enabled = true;
        console.log('[Auth] Firebase Admin initialised — Google sign-in enabled.');
    } else {
        console.warn('[Auth] Firebase service account not set — Google sign-in disabled.');
    }
} catch (e) {
    console.warn('[Auth] firebase-admin unavailable — Google sign-in disabled:', e.message);
}

const isGoogleEnabled = () => enabled;

const verifyIdToken = async (idToken) => {
    if (!enabled) throw new Error('Google sign-in is not configured on the server.');
    return admin.auth().verifyIdToken(idToken);
};

// --- Cloud Firestore (optional data store) ---
//
// Firestore reuses the same initialised Firebase Admin app. It is used as the
// primary data store ONLY when USE_FIRESTORE=1 AND a service account is
// configured; otherwise the app falls back to local SQLite (see store.js).
// This keeps the app working out-of-the-box while letting you flip a single
// env var to move users + verification batches into Cloud Firestore.
let firestore = null;
const wantFirestore = process.env.USE_FIRESTORE === '1';

if (wantFirestore) {
    if (enabled) {
        try {
            firestore = admin.firestore();
            firestore.settings({ ignoreUndefinedProperties: true });
            console.log('[Store] Cloud Firestore enabled — users & batches will be stored in Firestore.');
        } catch (e) {
            firestore = null;
            console.warn('[Store] USE_FIRESTORE=1 but Firestore could not be initialised — falling back to SQLite:', e.message);
        }
    } else {
        console.warn('[Store] USE_FIRESTORE=1 but no Firebase service account is set — falling back to SQLite.');
    }
}

const isFirestoreEnabled = () => firestore !== null;
const getFirestore = () => firestore;

module.exports = { isGoogleEnabled, verifyIdToken, isFirestoreEnabled, getFirestore };
