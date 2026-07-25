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

        // --- Cloud Firestore data store (the app's only data store) ---
        try {
            const { getFirestore: adminGetFirestore } = require('firebase-admin/firestore');
            firestore = adminGetFirestore(app);
            firestore.settings({ ignoreUndefinedProperties: true });
            console.log('[Store] Cloud Firestore enabled — all data is stored in Firestore.');
        } catch (e) {
            firestore = null;
            console.error('[Store] Firestore could not be initialised:', e.message);
        }
    } else {
        console.warn('[Auth] Firebase service account not set — Google sign-in disabled.');
    }
} catch (e) {
    console.warn('[Auth] firebase-admin unavailable:', e.message);
}

const isGoogleEnabled = () => enabled;

const verifyIdToken = async (idToken) => {
    if (!enabled) throw new Error('Google sign-in is not configured on the server.');
    return authInstance.verifyIdToken(idToken);
};

const isFirestoreEnabled = () => firestore !== null;
const getFirestore = () => firestore;

module.exports = { isGoogleEnabled, verifyIdToken, isFirestoreEnabled, getFirestore };
