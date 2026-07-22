// Firebase client setup — used only for Google (OAuth) sign-in.
//
// It is fully OPTIONAL. The `firebase` SDK is loaded LAZILY (dynamic import)
// only when someone actually clicks "Continue with Google". That means:
//   • if VITE_FIREBASE_* isn't set, or the firebase package isn't installed,
//     the app still runs and email/password auth works — only the Google
//     button reports a friendly error when clicked.
// Fill the keys from your Firebase project (Project settings → General → Your
// apps → Web app) in frontend/.env, and run `npm install` so the SDK is present.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// True when the essential keys are present.
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId
);

let authPromise = null;

// Lazily initialise Firebase Auth the first time it's needed.
async function getAuthInstance() {
  if (!isFirebaseConfigured) {
    throw new Error('Google sign-in is not configured. Add your Firebase keys in frontend/.env (see SETUP.md).');
  }
  if (!authPromise) {
    authPromise = (async () => {
      let appMod, authMod;
      try {
        appMod = await import('firebase/app');
        authMod = await import('firebase/auth');
      } catch {
        throw new Error('Google sign-in is unavailable — run `npm install` in the frontend folder to enable it.');
      }
      const { initializeApp, getApps } = appMod;
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      return authMod.getAuth(app);
    })();
  }
  return authPromise;
}

// Opens the Google popup and returns the Firebase ID token, which the backend
// verifies with firebase-admin. Throws a friendly error if unavailable.
export const googleSignIn = async () => {
  const auth = await getAuthInstance();
  const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user.getIdToken();
};
