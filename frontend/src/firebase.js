// Firebase client setup — used only for Google (OAuth) sign-in.
//
// It is fully OPTIONAL: if the VITE_FIREBASE_* env vars are not set, the app
// still works with email/password auth and the Google button simply reports
// that it isn't configured yet. Fill in the keys from your Firebase project
// (Project settings → General → Your apps → Web app) in frontend/.env.
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Configured only when the essential keys are present.
export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId
);

let auth = null;
if (isFirebaseConfigured) {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  auth = getAuth(app);
}

// Opens the Google popup and returns the Firebase ID token, which the backend
// verifies with firebase-admin. Throws a friendly error if not configured.
export const googleSignIn = async () => {
  if (!auth) {
    throw new Error('Google sign-in is not configured. Add your Firebase keys in frontend/.env (see SETUP.md).');
  }
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user.getIdToken();
};
