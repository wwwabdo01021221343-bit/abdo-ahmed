import { AppDatabase } from '../types';

export interface UserSession {
  username: string;
  password: string;
  shop: string;
  phone: string;
}

const SESSION_KEY = 'store_current_active_session_v2';
const REMEMBERED_CREDENTIALS_KEY = 'store_remembered_credentials_v1';

export interface RememberedCredentials {
  username: string;
  password?: string;
  shop?: string;
  phone?: string;
  rememberMe: boolean;
}

/**
 * Gets saved login credentials if user opted to remember them on this device.
 */
export function getRememberedCredentials(): RememberedCredentials | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(REMEMBERED_CREDENTIALS_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error reading remembered credentials:', e);
  }
  return null;
}

/**
 * Saves login credentials for fast login on this device.
 */
export function saveRememberedCredentials(creds: RememberedCredentials): void {
  if (typeof window === 'undefined') return;
  try {
    if (creds.rememberMe) {
      localStorage.setItem(REMEMBERED_CREDENTIALS_KEY, JSON.stringify(creds));
    } else {
      localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY);
    }
  } catch (e) {
    console.error('Error saving remembered credentials:', e);
  }
}

/**
 * Removes remembered credentials from this device.
 */
export function clearRememberedCredentials(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(REMEMBERED_CREDENTIALS_KEY);
  } catch (e) {
    console.error('Error clearing remembered credentials:', e);
  }
}

/**
 * Retrieves the currently active user session from memory or storage.
 */
export function getActiveSession(): UserSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.username && parsed.password) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Error reading session:', e);
  }
  return null;
}

/**
 * Saves the active session.
 */
export function saveActiveSession(session: UserSession, remember: boolean = true): void {
  if (typeof window === 'undefined') return;
  try {
    const jsonStr = JSON.stringify(session);
    if (remember) {
      localStorage.setItem(SESSION_KEY, jsonStr);
    } else {
      sessionStorage.setItem(SESSION_KEY, jsonStr);
    }
  } catch (e) {
    console.error('Error saving session:', e);
  }
}

/**
 * Completely clears the active user session.
 */
export function clearActiveSession(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    // Also clean up any legacy pre-account keys
    localStorage.removeItem('tayeb_library_v3');
    localStorage.removeItem('tayeb_library_v2');
    localStorage.removeItem('tayeb_library_db');
  } catch (e) {
    console.error('Error clearing session:', e);
  }
}

/**
 * Gets cached data for a specific user.
 */
export function getUserLocalData(username: string): AppDatabase | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`store_user_db_${username.toLowerCase()}`);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error reading local user data:', e);
  }
  return null;
}

/**
 * Saves cached data for a specific user.
 */
export function saveUserLocalData(username: string, db: AppDatabase): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`store_user_db_${username.toLowerCase()}`, JSON.stringify(db));
  } catch (e) {
    console.error('Error saving local user data:', e);
  }
}

/**
 * Server API call: Register a brand new store
 */
export async function apiRegisterStore(params: {
  username: string;
  password: string;
  shop: string;
  phone: string;
}): Promise<{ user: UserSession; db: AppDatabase }> {
  const res = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || 'فشل إنشاء حساب المتجر');
  }

  const session: UserSession = {
    username: data.user.username,
    password: params.password,
    shop: data.user.shop,
    phone: data.user.phone || '',
  };

  saveActiveSession(session);
  saveUserLocalData(session.username, data.db);

  return { user: session, db: data.db };
}

/**
 * Server API call: Login to an existing store
 */
export async function apiLoginStore(params: {
  username: string;
  password: string;
}): Promise<{ user: UserSession; db: AppDatabase }> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }

  const session: UserSession = {
    username: data.user.username,
    password: params.password,
    shop: data.user.shop,
    phone: data.user.phone || '',
  };

  saveActiveSession(session);
  saveUserLocalData(session.username, data.db);

  return { user: session, db: data.db };
}

/**
 * Syncs the active store database to the server.
 */
export async function apiSaveStoreData(
  session: UserSession,
  db: AppDatabase
): Promise<void> {
  // Always save locally immediately
  saveUserLocalData(session.username, db);

  try {
    await fetch('/api/store/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: session.username,
        password: session.password,
        db,
      }),
    });
  } catch (e) {
    console.warn('Network sync failed, data saved locally:', e);
  }
}

/**
 * Changes user password on the server and updates active session.
 */
export async function apiChangePassword(
  session: UserSession,
  oldPass: string,
  newPass: string
): Promise<{ success: boolean; message?: string }> {
  const res = await fetch('/api/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: session.username,
      oldPassword: oldPass,
      newPassword: newPass,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || 'تعذر تغيير كلمة المرور');
  }

  const updatedSession = { ...session, password: newPass };
  saveActiveSession(updatedSession);
  return data;
}

/**
 * Permanently deletes user account and store data from server and local storage.
 */
export async function apiDeleteAccount(
  session: UserSession,
  confirmationText: string,
  passwordConfirm?: string
): Promise<{ success: boolean; message?: string }> {
  const res = await fetch('/api/delete-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: session.username,
      password: passwordConfirm || session.password,
      confirmationText: confirmationText,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.message || 'تعذر حذف الحساب');
  }

  // Purge local storage caches for this user
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(`store_user_db_${session.username.toLowerCase()}`);
      localStorage.removeItem('tayeb_library_v3');
      localStorage.removeItem('tayeb_library_v2');
      localStorage.removeItem('tayeb_library_db');
    } catch (e) {
      console.error('Error clearing local cached database:', e);
    }
  }

  // Clear session keys
  clearActiveSession();

  return data;
}

