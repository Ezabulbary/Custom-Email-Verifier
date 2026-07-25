// Optional Firebase Admin — used to verify Google sign-in ID tokens and,
// optionally, as the Cloud Firestore data store.
//
// It self-enables when a service account is provided, via either:
//   - FIREBASE_SERVICE_ACCOUNT       = the service-account JSON, stringified
//   - GOOGLE_APPLICATION_CREDENTIALS = path to the serviceAccount.json file
//
// If neither is set (or firebase-admin isn't installed), Google sign-in is
// simply disabled and the email/password flow keeps working unchanged.
//
// NOTE: we use the MODULAR entry points (firebase-admin/app, /auth, /firestore).
// Recent firebase-admin versions no longer expose the legacy `admin.credential`
// namespace, so `admin.credential.cert(...)` throws "Cannot read properties of
// undefined". The modular API below is stable across versions.
let enabled = false;
let firestore = null;
let authInstance = null;
// Cloud Firestore is the data store whenever a Firebase service account is
// configured. Set USE_FIRESTORE=0 to force local SQLite even with Firebase set
// up (e.g. if you only want Google sign-in, not Firestore storage).
const firestoreDisabled = process.env.USE_FIRESTORE === '0';

try {
    const { initializeApp, getApps, cert, applicationDefault } = require('firebase-admin/app');

    let credential = null;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        credential = applicationDefault();
    } else {
        // Convenience: auto-detect a serviceAccount.json in the project root, so
        // you only need to drop the file in — no env var required.
        const fs = require('fs');
        const localSa = require('path').join(__dirname, 'serviceAccount.json');
        if (fs.existsSync(localSa)) {
            credential = cert(JSON.parse(fs.readFileSync(localSa, 'utf8')));
            console.log('[Auth] Using ./serviceAccount.json');
        }
    }

    if (credential) {
        const app = getApps().length ? getApps()[0] : initializeApp({ credential });

        const { getAuth } = require('firebase-admin/auth');
        authInstance = getAuth(app);
        enabled = true;
        console.log('[Auth] Firebase Admin initialised — Google sign-in enabled.');

        // --- Cloud Firestore data store ---
        // Reuses the same initialised app. Active by default once Firebase is
        // configured; USE_FIRESTORE=0 forces local SQLite instead.
        if (!firestoreDisabled) {
            try {
                const { getFirestore: adminGetFirestore } = require('firebase-admin/firestore');
                firestore = adminGetFirestore(app);
                firestore.settings({ ignoreUndefinedProperties: true });
                console.log('[Store] Cloud Firestore enabled — all data will be stored in Firestore.');
            } catch (e) {
                firestore = null;
                console.warn('[Store] Firestore could not be initialised — falling back to SQLite:', e.message);
            }
        } else {
            console.log('[Store] USE_FIRESTORE=0 — Firestore disabled, using local SQLite.');
        }
    } else {
        console.warn('[Auth] Firebase service account not set — Google sign-in disabled, using local SQLite.');
    }
} catch (e) {
    console.warn('[Auth] firebase-admin unavailable — Google sign-in disabled, using local SQLite:', e.message);
}

const isGoogleEnabled = () => enabled;

const verifyIdToken = async (idToken) => {
    if (!enabled) throw new Error('Google sign-in is not configured on the server.');
    return authInstance.verifyIdToken(idToken);
};

const isFirestoreEnabled = () => firestore !== null;
const getFirestore = () => firestore;

module.exports = { isGoogleEnabled, verifyIdToken, isFirestoreEnabled, getFirestore };
