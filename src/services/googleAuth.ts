import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App singleton
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Workspace Google Drive + Gmail scopes
export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.metadata',
  'https://www.googleapis.com/auth/drive.readonly',
];

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
];

export const WORKSPACE_SCOPES = [
  ...DRIVE_SCOPES,
  ...GMAIL_SCOPES,
];

const provider = new GoogleAuthProvider();
WORKSPACE_SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({ prompt: 'select_account' });

// In-memory token storage (MANDATORY: never stored in localStorage / sessionStorage)
let cachedAccessToken: string | null = null;
let cachedUserEmail: string | null = null;
let isSigningIn = false;

/**
 * Initialize auth listener. Calls callbacks when auth state changes.
 */
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      cachedUserEmail = user.email ? user.email.toLowerCase() : null;
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      cachedUserEmail = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

/**
 * Must be triggered by user interaction (button click).
 */
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('تعذر استخراج تصريح الوصول (OAuth Access Token) من Google');
    }

    cachedAccessToken = credential.accessToken;
    cachedUserEmail = result.user.email ? result.user.email.toLowerCase() : null;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: unknown) {
    console.error('Google Sign-In Error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Retrieves the currently cached in-memory access token.
 */
export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const getCachedUserEmail = (): string | null => {
  return cachedUserEmail;
};

/**
 * Updates in-memory access token.
 */
export const setCachedAccessToken = (token: string | null) => {
  cachedAccessToken = token;
};

/**
 * Sign out user and purge token from memory.
 */
export const logoutGoogle = async (): Promise<void> => {
  await signOut(auth);
  cachedAccessToken = null;
  cachedUserEmail = null;
};
