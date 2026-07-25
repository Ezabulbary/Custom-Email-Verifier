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
const wantFirestore = process.env.USE_FIRESTORE === '1';

try {
    const { initializeApp, getApps, cert, applicationDefault } = require('firebase-admin/app');

    let credential = null;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        credential = applicationDefault();
    }

    if (credential) {
        const app = getApps().length ? getApps()[0] : initializeApp({ credential });

        const { getAuth } = require('firebase-admin/auth');
        authInstance = getAuth(app);
        enabled = true;
        console.log('[Auth] Firebase Admin initialised — Google sign-in enabled.');

        // --- Cloud Firestore (optional data store) ---
        // Reuses the same initialised app. Enabled only when USE_FIRESTORE=1;
        // otherwise the app uses local SQLite (see store.js).
        if (wantFirestore) {
            try {
                const { getFirestore: adminGetFirestore } = require('firebase-admin/firestore');
                firestore = adminGetFirestore(app);
                firestore.settings({ ignoreUndefinedProperties: true });
                console.log('[Store] Cloud Firestore enabled — users & batches will be stored in Firestore.');
            } catch (e) {
                firestore = null;
                console.warn('[Store] USE_FIRESTORE=1 but Firestore could not be initialised — falling back to SQLite:', e.message);
            }
        }
    } else {
        console.warn('[Auth] Firebase service account not set — Google sign-in disabled.');
        if (wantFirestore) {
            console.warn('[Store] USE_FIRESTORE=1 but no Firebase service account is set — falling back to SQLite.');
        }
    }
} catch (e) {
    console.warn('[Auth] firebase-admin unavailable — Google sign-in disabled:', e.message);
    if (wantFirestore) {
        console.warn('[Store] USE_FIRESTORE=1 but firebase-admin is unavailable — falling back to SQLite.');
    }
}

const isGoogleEnabled = () => enabled;

const verifyIdToken = async (idToken) => {
    if (!enabled) throw new Error('Google sign-in is not configured on the server.');
    return authInstance.verifyIdToken(idToken);
};

const isFirestoreEnabled = () => firestore !== null;
const getFirestore = () => firestore;

module.exports = { isGoogleEnabled, verifyIdToken, isFirestoreEnabled, getFirestore };
