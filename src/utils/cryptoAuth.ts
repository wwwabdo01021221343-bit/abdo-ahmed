export const APP_GATE_STORAGE_KEY = 'tayeb_app_gate_unlocked_v2';
export const APP_GATE_TOKEN_KEY = 'tayeb_gate_token_v1';
export const OWNER_CUSTOM_PIN_HASH_KEY = 'tayeb_owner_custom_pin_hash_v1';
export const GATE_CUSTOM_CREDENTIALS_KEY = 'tayeb_gate_custom_creds_v1';
const AUTH_SALT = 'tayeb_sec_v3_9f2a7c';
const OFFLINE_USER_DIGEST = 'fd96021b3dc11a9e555e4d2d3223f76086aee3c64d5047dc0516eea9f91d1f32';
const OFFLINE_PASS_DIGEST = '1950e30a497951b180dfd05671785e6fa870be48c8ee28dffe4ec5718834ac8a';
const OFFLINE_LOCK_KEY = 'tayeb_gate_lockout_v1';

export function normalizeCredentialDigits(val: string): string {
  return String(val || '')
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

// Pure JS SHA-256 fallback (used when crypto.subtle is unavailable in Node test or insecure contexts)
function sha256Fallback(ascii: string): string {
  const bytes = new TextEncoder().encode(ascii);
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const bitLen = bytes.length * 8;
  const withOneLen = bytes.length + 1;
  const padLen = (64 - ((withOneLen + 8) % 64)) % 64;
  const totalLen = withOneLen + padLen + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);
  dv.setUint32(totalLen - 4, bitLen >>> 0, false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return Array.from(H)
    .map((n) => n.toString(16).padStart(8, '0'))
    .join('');
}

export async function sha256Hex(text: string): Promise<string> {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    try {
      const data = new TextEncoder().encode(text);
      const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      return sha256Fallback(text);
    }
  }
  return sha256Fallback(text);
}

export async function saltedCredentialHash(raw: string): Promise<string> {
  return sha256Hex(AUTH_SALT + normalizeCredentialDigits(raw));
}

function readCustomGateCredsOffline(): { uHash: string; pHash: string } | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(GATE_CUSTOM_CREDENTIALS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { uHash?: string; pHash?: string };
    if (typeof parsed?.uHash === 'string' && typeof parsed?.pHash === 'string') {
      return { uHash: parsed.uHash, pHash: parsed.pHash };
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveCustomGateCredentialsOffline(newUsername: string, newPassword: string): Promise<void> {
  const [uHash, pHash] = await Promise.all([
    saltedCredentialHash(newUsername),
    saltedCredentialHash(newPassword),
  ]);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(GATE_CUSTOM_CREDENTIALS_KEY, JSON.stringify({ uHash, pHash }));
  }
}

export async function verifyGateCredentialsOffline(username: string, password: string): Promise<boolean> {
  const [uHash, pHash] = await Promise.all([
    saltedCredentialHash(username),
    saltedCredentialHash(password),
  ]);
  const custom = readCustomGateCredsOffline();
  if (custom) {
    return uHash === custom.uHash && pHash === custom.pHash;
  }
  return uHash === OFFLINE_USER_DIGEST && pHash === OFFLINE_PASS_DIGEST;
}

export async function verifyOwnerPinOffline(pin: string): Promise<boolean> {
  const customHash = typeof localStorage !== 'undefined' ? localStorage.getItem(OWNER_CUSTOM_PIN_HASH_KEY) : null;
  const candidate = await saltedCredentialHash(pin);
  return candidate === (customHash || OFFLINE_PASS_DIGEST);
}

export async function saveCustomOwnerPinOffline(newPin: string): Promise<void> {
  const digest = await saltedCredentialHash(newPin);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(OWNER_CUSTOM_PIN_HASH_KEY, digest);
  }
}

export function getStoredGateToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(APP_GATE_TOKEN_KEY) || sessionStorage.getItem(APP_GATE_TOKEN_KEY);
}

export function storeGateToken(token: string, remember: boolean): void {
  if (typeof window === 'undefined') return;
  if (remember) {
    localStorage.setItem(APP_GATE_TOKEN_KEY, token);
  } else {
    sessionStorage.setItem(APP_GATE_TOKEN_KEY, token);
  }
}

export function clearGateTokens(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(APP_GATE_TOKEN_KEY);
  sessionStorage.removeItem(APP_GATE_TOKEN_KEY);
  localStorage.removeItem(APP_GATE_STORAGE_KEY);
  sessionStorage.removeItem(APP_GATE_STORAGE_KEY);
  localStorage.removeItem('tayeb_app_gate_unlocked');
  sessionStorage.removeItem('tayeb_app_gate_unlocked');
  localStorage.removeItem('tayeb_owner_unlocked');
}

function getOfflineLockState(): { count: number; until: number } {
  try {
    const raw = localStorage.getItem(OFFLINE_LOCK_KEY);
    if (!raw) return { count: 0, until: 0 };
    const parsed = JSON.parse(raw);
    return {
      count: Number(parsed?.count) || 0,
      until: Number(parsed?.until) || 0,
    };
  } catch {
    return { count: 0, until: 0 };
  }
}

export function getOfflineLockRemainingSeconds(): number {
  if (typeof localStorage === 'undefined') return 0;
  const state = getOfflineLockState();
  const diff = state.until - Date.now();
  return diff > 0 ? Math.ceil(diff / 1000) : 0;
}

function recordOfflineFailedAttempt(): number {
  if (typeof localStorage === 'undefined') return 0;
  const state = getOfflineLockState();
  const nextCount = state.count + 1;
  let until = 0;
  if (nextCount >= 5) {
    until = Date.now() + 60_000;
  }
  localStorage.setItem(OFFLINE_LOCK_KEY, JSON.stringify({ count: nextCount, until }));
  return until > 0 ? 60 : 0;
}

function clearOfflineFailedAttempts(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(OFFLINE_LOCK_KEY);
  }
}

export async function verifyGateCredentials(
  username: string,
  password: string,
  rememberDevice: boolean
): Promise<{ success: boolean; token?: string; message?: string }> {
  const cleanUser = normalizeCredentialDigits(username);
  const cleanPass = normalizeCredentialDigits(password);

  try {
    const resp = await fetch('/api/gate/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cleanUser, password: cleanPass, remember: rememberDevice }),
    });
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await resp.json();
      if (resp.ok && json.success) {
        clearOfflineFailedAttempts();
        if (json.token) storeGateToken(json.token, rememberDevice);
        return { success: true, token: json.token };
      }
      return {
        success: false,
        message: json.message || 'اسم المستخدم أو كلمة المرور غير صحيحة.',
      };
    }
  } catch {
    // Network unreachable / offline PWA — use local hash & lockout fallback
  }

  const remaining = getOfflineLockRemainingSeconds();
  if (remaining > 0) {
    return {
      success: false,
      message: `تم إيقاف المحاولات مؤقتاً لحماية النظام. حاول بعد ${remaining} ثانية.`,
    };
  }

  const ok = await verifyGateCredentialsOffline(cleanUser, cleanPass);
  if (ok) {
    clearOfflineFailedAttempts();
    return { success: true };
  }
  const lockedSeconds = recordOfflineFailedAttempt();
  if (lockedSeconds > 0) {
    return {
      success: false,
      message: `تم تجاوز عدد المحاولات الخاطئة. تم القفل مؤقتاً لمدة ${lockedSeconds} ثانية.`,
    };
  }
  return {
    success: false,
    message: 'اسم المستخدم أو كلمة المرور غير صحيحة، يرجى المحاولة مرة أخرى.',
  };
}

export async function verifyOwnerPin(pin: string): Promise<{ success: boolean; message?: string }> {
  const cleanPin = normalizeCredentialDigits(pin);
  try {
    const resp = await fetch('/api/owner/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: cleanPin }),
    });
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await resp.json();
      if (resp.ok && json.success) {
        return { success: true };
      }
      return { success: false, message: json.message || 'رمز المرور السري غير صحيح!' };
    }
  } catch {
    // Offline fallback
  }

  const ok = await verifyOwnerPinOffline(cleanPin);
  if (ok) return { success: true };
  return { success: false, message: 'رمز المرور السري غير صحيح! يرجى التحقق وإعادة المحاولة.' };
}

export async function updateOwnerPin(
  currentPin: string,
  newPin: string
): Promise<{ success: boolean; message: string }> {
  const cleanCurrent = normalizeCredentialDigits(currentPin);
  const cleanNew = normalizeCredentialDigits(newPin);
  if (cleanNew.length < 4) {
    return { success: false, message: 'يجب أن يتكون الرمز السري الجديد من 4 أرقام أو أحرف على الأقل' };
  }

  try {
    const resp = await fetch('/api/owner/change-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getStoredGateToken() ? { Authorization: `Bearer ${getStoredGateToken()}` } : {}),
      },
      body: JSON.stringify({ currentPin: cleanCurrent, newPin: cleanNew }),
    });
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await resp.json();
      if (resp.ok && json.success) {
        await saveCustomOwnerPinOffline(cleanNew);
        return { success: true, message: json.message || 'تم تحديث الرمز السري للمالك بنجاح!' };
      }
      return { success: false, message: json.message || 'تعذر تغيير الرمز السري' };
    }
  } catch {
    // Offline fallback
  }

  await saveCustomOwnerPinOffline(cleanNew);
  return { success: true, message: 'تم تحديث الرمز السري على هذا الجهاز بنجاح!' };
}

export async function updateGateCredentials(
  currentPassword: string,
  newUsername: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  const cleanOld = normalizeCredentialDigits(currentPassword);
  const cleanUser = normalizeCredentialDigits(newUsername);
  const cleanNew = normalizeCredentialDigits(newPassword);

  if (!cleanUser || cleanNew.length < 4) {
    return { success: false, message: 'يرجى إدخال اسم مستخدم وكلمة مرور لا تقل عن 4 أحرف/أرقام.' };
  }

  try {
    const resp = await fetch('/api/gate/change-credentials', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getStoredGateToken() ? { Authorization: `Bearer ${getStoredGateToken()}` } : {}),
      },
      body: JSON.stringify({
        currentPassword: cleanOld,
        newUsername: cleanUser,
        newPassword: cleanNew,
      }),
    });
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await resp.json();
      if (resp.ok && json.success) {
        await saveCustomGateCredentialsOffline(cleanUser, cleanNew);
        return { success: true, message: json.message || 'تم تحديث بيانات بوابة الدخول بنجاح!' };
      }
      return { success: false, message: json.message || 'تعذر تحديث بيانات البوابة' };
    }
  } catch {
    // Unreachable backend / static Firebase Hosting
  }

  // Static hosting or offline fallback: verify against existing offline credentials before updating locally
  const currentGateCheck = readCustomGateCredsOffline();
  const currentPassHash = await saltedCredentialHash(cleanOld);
  const expectedPassHash = currentGateCheck?.pHash || OFFLINE_PASS_DIGEST;
  if (currentPassHash !== expectedPassHash) {
    return { success: false, message: 'كلمة المرور الحالية غير صحيحة!' };
  }
  await saveCustomGateCredentialsOffline(cleanUser, cleanNew);
  return {
    success: true,
    message: 'تم تحديث بيانات بوابة الدخول على هذا الجهاز بنجاح!',
  };
}
