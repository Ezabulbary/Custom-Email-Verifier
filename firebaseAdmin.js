// Optional Firebase Admin — used ONLY to verify Google sign-in ID tokens.
//
// It self-enables when a service account is provided, via either:
//   - FIREBASE_SERVICE_ACCOUNT       = the service-account JSON, stringified
//   - GOOGLE_APPLICATION_CREDENTIALS = path to the serviceAccount.json file
//
// If neither is set (or firebase-admin isn't installed), Google sign-in is
// simply disabled and the email/password flow keeps working unchanged.

let verifyTokenFn = null;
let enabled = false;

try {
    const { initializeApp, cert, applicationDefault, getApps } = require('firebase-admin/app');
    const { getAuth } = require('firebase-admin/auth');

    let credential = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        credential = applicationDefault();
    }

    if (credential) {
        const app = getApps().length === 0
            ? initializeApp({ credential })
            : getApps()[0];
        const auth = getAuth(app);
        verifyTokenFn = (idToken) => auth.verifyIdToken(idToken);
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
    return verifyTokenFn(idToken);
};

module.exports = { isGoogleEnabled, verifyIdToken };
