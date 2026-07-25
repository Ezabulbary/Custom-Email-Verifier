// Optional Firebase Admin — used ONLY to verify Google sign-in ID tokens
// and optionally for Cloud Firestore (when USE_FIRESTORE=1).
//
// It self-enables when a service account is provided, via either:
//   - FIREBASE_SERVICE_ACCOUNT       = the service-account JSON, stringified
//   - GOOGLE_APPLICATION_CREDENTIALS = path to the serviceAccount.json file

let adminApp = null;
let adminAuth = null;
let enabled = false;
let firestore = null;

try {
    let initializeApp, cert, applicationDefault, getAuth, getFirestore;
    try {
        const appMod = require('firebase-admin/app');
        initializeApp = appMod.initializeApp;
        cert = appMod.cert;
        applicationDefault = appMod.applicationDefault;
        getAuth = require('firebase-admin/auth').getAuth;
        getFirestore = require('firebase-admin/firestore').getFirestore;
    } catch {
        const fa = require('firebase-admin');
        initializeApp = fa.initializeApp;
        cert = fa.credential?.cert?.bind(fa.credential);
        applicationDefault = fa.credential?.applicationDefault?.bind(fa.credential);
        getAuth = (app) => (app ? app.auth() : fa.auth());
        getFirestore = (app) => (app ? app.firestore() : fa.firestore());
    }

    let credential = null;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
            const serviceAccount = typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'string'
                ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
                : process.env.FIREBASE_SERVICE_ACCOUNT;
            if (cert) credential = cert(serviceAccount);
        } catch (e) {
            console.warn('[Auth] Failed to parse FIREBASE_SERVICE_ACCOUNT:', e.message);
        }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        if (applicationDefault) credential = applicationDefault();
    }

    if (credential) {
        adminApp = initializeApp({ credential });
        adminAuth = getAuth(adminApp);
        enabled = true;
        console.log('[Auth] Firebase Admin initialised — Google sign-in enabled.');

        if (process.env.USE_FIRESTORE === '1') {
            try {
                firestore = getFirestore(adminApp);
                if (firestore && typeof firestore.settings === 'function') {
                    firestore.settings({ ignoreUndefinedProperties: true });
                }
                console.log('[Store] Cloud Firestore enabled — users & batches will be stored in Firestore.');
            } catch (e) {
                firestore = null;
                console.warn('[Store] USE_FIRESTORE=1 but Firestore initialisation failed — falling back to SQLite:', e.message);
            }
        }
    } else {
        console.warn('[Auth] Firebase service account not set — Google sign-in disabled.');
        if (process.env.USE_FIRESTORE === '1') {
            console.warn('[Store] USE_FIRESTORE=1 but no Firebase service account is set — falling back to SQLite.');
        }
    }
} catch (e) {
    console.warn('[Auth] firebase-admin unavailable — Google sign-in disabled:', e.message);
}

const isGoogleEnabled = () => enabled;
const verifyIdToken = async (idToken) => {
    if (!enabled || !adminAuth) throw new Error('Google sign-in is not configured on the server.');
    return adminAuth.verifyIdToken(idToken);
};

const isFirestoreEnabled = () => firestore !== null;
const getFirestore = () => firestore;

module.exports = { isGoogleEnabled, verifyIdToken, isFirestoreEnabled, getFirestore };
