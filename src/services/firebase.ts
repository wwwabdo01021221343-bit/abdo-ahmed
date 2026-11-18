import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  enableNetwork,
  disableNetwork,
  waitForPendingWrites,
  deleteField,
  collection, 
  doc, 
  getDoc,
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  getDocFromServer,
  getDocsFromServer,
  writeBatch,
  getDocs,
  getDocsFromCache
} from 'firebase/firestore';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  User 
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  AppDatabase,
  CloudBackupChunk,
  CloudBackupManifest,
  CloudBackupReason,
  Invoice,
  Product,
  ShortageItem,
  StoreSettings,
  TrashItem,
} from '../types';
import {
  buildDailyBackupId,
  buildSnapshotChunks,
  getDailyBackupDateKey,
  reassembleDatabaseFromBackup,
} from '../utils/backupTrashLogic';
import { WORKSPACE_SCOPES, setCachedAccessToken } from './googleAuth';

export const OWNER_EMAIL = 'www.abdo01021221343@gmail.com';

// 1. Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// 2. Initialize Firestore with IndexedDB Persistent Offline Cache + Multi-Tab support
const firestoreDatabaseId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;

function createPersistentDb() {
  try {
    return initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firestoreDatabaseId
    );
  } catch {
    return firestoreDatabaseId ? getFirestore(app, firestoreDatabaseId) : getFirestore(app);
  }
}

export const db = createPersistentDb();

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`sync-timeout: ${label} exceeded ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// Helper to ensure network is re-enabled and flush pending IndexedDB writes when internet returns
// Never hangs forever when connectivity is flaky or half-open.
export async function reconnectFirestore(forceCycle = false): Promise<void> {
  try {
    if (forceCycle) {
      await withTimeout(disableNetwork(db), 2000, 'disableNetwork').catch(() => {});
    }
    await withTimeout(enableNetwork(db), 3500, 'enableNetwork');
    await withTimeout(waitForPendingWrites(db), 4500, 'waitForPendingWrites');
  } catch (err) {
    console.warn('Firestore reconnect wait note:', err);
  }
}

// 3. Initialize Firebase Auth
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
WORKSPACE_SCOPES.forEach((scope) => googleProvider.addScope(scope));
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Error handling types and helper as required by Firebase skill
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export interface SnapshotMeta {
  fromCache: boolean;
  hasPendingWrites: boolean;
}

function isPermissionError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const code = (error as { code?: string })?.code?.toLowerCase() || '';
  return code.includes('permission-denied') || msg.includes('missing or insufficient permissions');
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const currentUser = auth.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo: currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || [],
    },
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Connection test on boot (works for both Owner and non-owner store terminals)
export async function testFirestoreConnection(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  try {
    await getDocFromServer(doc(db, 'settings', 'main'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore is running in offline mode:', error.message);
    }
    return false;
  }
}

export type CloudAuthStatus =
  | 'unauthenticated'
  | 'checking'
  | 'authorized'
  | 'unauthorized'
  | 'unverified';

export interface AuthorizedEmailRecord {
  email: string;
  label?: string;
  role: 'cashier';
  addedAt: string;
  addedBy?: string;
}

const CLOUD_AUTH_UID_CACHE_KEY = 'tayeb_cloud_auth_uid_v1';

export async function checkCurrentUserCloudAuthorization(
  user: User | null
): Promise<{ status: CloudAuthStatus; isOwner: boolean }> {
  if (!user) {
    return { status: 'unauthenticated', isOwner: false };
  }
  if (!user.emailVerified) {
    return { status: 'unverified', isOwner: false };
  }

  const email = String(user.email || '').trim().toLowerCase();
  if (email === OWNER_EMAIL.toLowerCase()) {
    try {
      localStorage.setItem(CLOUD_AUTH_UID_CACHE_KEY, user.uid);
    } catch {
      // Ignore storage failures
    }
    return { status: 'authorized', isOwner: true };
  }

  try {
    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    if (adminSnap.exists()) {
      try {
        localStorage.setItem(CLOUD_AUTH_UID_CACHE_KEY, user.uid);
      } catch {
        // Ignore
      }
      return { status: 'authorized', isOwner: true };
    }
  } catch (err) {
    if (!isPermissionError(err)) {
      const cachedUid = typeof localStorage !== 'undefined' ? localStorage.getItem(CLOUD_AUTH_UID_CACHE_KEY) : null;
      if (cachedUid === user.uid) {
        return { status: 'authorized', isOwner: false };
      }
    }
  }

  if (email) {
    try {
      const staffSnap = await getDoc(doc(db, 'authorized_emails', email));
      if (staffSnap.exists()) {
        try {
          localStorage.setItem(CLOUD_AUTH_UID_CACHE_KEY, user.uid);
        } catch {
          // Ignore
        }
        return { status: 'authorized', isOwner: false };
      }
    } catch (err) {
      if (!isPermissionError(err)) {
        const cachedUid = typeof localStorage !== 'undefined' ? localStorage.getItem(CLOUD_AUTH_UID_CACHE_KEY) : null;
        if (cachedUid === user.uid) {
          return { status: 'authorized', isOwner: false };
        }
      }
    }
  }

  return { status: 'unauthorized', isOwner: false };
}

// Auth state listener & Role check
export function subscribeToAuth(callback: (user: User | null, isOwner: boolean) => void) {
  return onAuthStateChanged(auth, (user) => {
    const isOwner = Boolean(
      user &&
      user.emailVerified &&
      user.email &&
      user.email.toLowerCase() === OWNER_EMAIL.toLowerCase()
    );
    callback(user, isOwner);
  });
}

function formatGoogleAuthError(err: any): string {
  const code = String(err?.code || '');
  if (code.includes('popup-closed-by-user')) {
    return 'تم إغلاق نافذة تسجيل الدخول قبل إتمام الاختيار.';
  }
  if (code.includes('popup-blocked')) {
    return 'قام المتصفح بحظر نافذة Google المنبثقة. اسمح للنوافذ المنبثقة لهذا الموقع وحاول مرة أخرى.';
  }
  if (code.includes('unauthorized-domain')) {
    return 'هذا النطاق يحتاج للتصريح من إعدادات Firebase Auth في لوحة التحكم.';
  }
  return err?.message || 'فشل تسجيل الدخول بواسطة Google';
}

// Google Sign-In for Store Cloud Sync (Owner Workspace + Cloud Access)
export async function signInWithGoogleForCloud(): Promise<{ success: boolean; isOwner: boolean; email?: string; error?: string }> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (credential?.accessToken) {
      setCachedAccessToken(credential.accessToken);
    }
    const email = result.user.email || '';
    const isOwner = Boolean(result.user.emailVerified && email.toLowerCase() === OWNER_EMAIL.toLowerCase());
    return { success: true, isOwner, email };
  } catch (err: any) {
    console.error('Google Sign-in error:', err);
    return { success: false, isOwner: false, error: formatGoogleAuthError(err) };
  }
}

// Google Sign-In for Owner
export async function signInAsOwner(): Promise<{ success: boolean; isOwner: boolean; email?: string; error?: string }> {
  return signInWithGoogleForCloud();
}

export async function signOutOwner(): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CLOUD_AUTH_UID_CACHE_KEY);
    }
    await signOut(auth);
  } catch (err) {
    console.error('Sign-out error:', err);
  }
}

// 3b. Authorized Store Emails Management (Owner Only)
export function subscribeToAuthorizedEmails(
  onData: (records: AuthorizedEmailRecord[]) => void,
  onError?: (err: Error) => void
) {
  const path = 'authorized_emails';
  return onSnapshot(
    collection(db, path),
    (snapshot) => {
      const list: AuthorizedEmailRecord[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        list.push({
          email: String(d.email || docSnap.id).toLowerCase(),
          label: typeof d.label === 'string' ? d.label : '',
          role: 'cashier',
          addedAt: String(d.addedAt || ''),
          addedBy: typeof d.addedBy === 'string' ? d.addedBy : undefined,
        });
      });
      list.sort((a, b) => a.email.localeCompare(b.email));
      onData(list);
    },
    (error) => {
      onError?.(error);
      if (isPermissionError(error)) {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  );
}

export async function addAuthorizedEmail(emailInput: string, labelInput?: string): Promise<void> {
  const cleanEmail = String(emailInput || '').trim().toLowerCase().slice(0, 150);
  if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(cleanEmail)) {
    throw new Error('صيغة البريد الإلكتروني غير صحيحة');
  }
  const path = `authorized_emails/${cleanEmail}`;
  const cleanLabel = String(labelInput || '').trim().slice(0, 100);
  const payload: Record<string, any> = {
    email: cleanEmail,
    role: 'cashier',
    addedAt: new Date().toISOString(),
  };
  if (cleanLabel) {
    payload.label = cleanLabel;
  }
  if (auth.currentUser?.email) {
    payload.addedBy = String(auth.currentUser.email).toLowerCase().slice(0, 150);
  }
  try {
    await setDoc(doc(db, 'authorized_emails', cleanEmail), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function removeAuthorizedEmail(emailInput: string): Promise<void> {
  const cleanEmail = String(emailInput || '').trim().toLowerCase().slice(0, 150);
  const path = `authorized_emails/${cleanEmail}`;
  try {
    await deleteDoc(doc(db, 'authorized_emails', cleanEmail));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

function stableShortHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

export function sanitizeDocId(rawId: string, fallbackSeed = ''): string {
  const trimmed = String(rawId || '').trim();
  if (/^[a-zA-Z0-9][a-zA-Z0-9_\-]{0,127}$/.test(trimmed)) {
    return trimmed;
  }
  const source = trimmed || String(fallbackSeed || '').trim();
  if (!source) {
    return `item_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }
  const asciiPrefix = trimmed
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .replace(/^_+/, '')
    .slice(0, 90);
  const hash = stableShortHash(source);
  return `${asciiPrefix || 'doc'}_${hash}`.slice(0, 128);
}

// Sanitize product object to enforce Firestore schema & prevent undefined/oversized values
function sanitizeProduct(p: Product): Record<string, any> {
  const cleanName = String(p.name || 'صنف').trim().slice(0, 300) || 'صنف';
  const cleanCategory = String(p.category || 'بدون مجموعة').trim().slice(0, 150) || 'بدون مجموعة';
  const safePrice = Number.isFinite(Number(p.price)) ? Math.max(0, Number(p.price)) : 0;

  const data: Record<string, any> = {
    id: sanitizeDocId(p.id, cleanName),
    name: cleanName,
    price: safePrice,
    category: cleanCategory,
  };

  const wholesale = p.wholesalePrice ?? p.buyWholesale;
  if (wholesale !== undefined && wholesale !== null && Number.isFinite(Number(wholesale)) && Number(wholesale) >= 0) {
    data.wholesalePrice = Number(wholesale);
  }
  const dozen = p.dozenPrice ?? p.sellDozenRetail;
  if (dozen !== undefined && dozen !== null && Number.isFinite(Number(dozen)) && Number(dozen) >= 0) {
    data.dozenPrice = Number(dozen);
  }
  if (p.image && typeof p.image === 'string' && p.image.length <= 250000) {
    data.image = p.image;
  }
  if (p.createdAt && typeof p.createdAt === 'string') {
    data.createdAt = p.createdAt.slice(0, 64);
  }
  data.updatedAt = new Date().toISOString();
  if (auth.currentUser?.email) {
    data.updatedBy = String(auth.currentUser.email).slice(0, 128);
  }

  return data;
}

// 4. Real-time Products Sync (Offline-first via IndexedDB + Live Cloud Updates)
export function subscribeToProducts(
  onData: (products: Product[], meta: SnapshotMeta) => void,
  onError?: (err: Error) => void
) {
  const path = 'products';
  return onSnapshot(
    collection(db, path),
    { includeMetadataChanges: true },
    (snapshot) => {
      const items: Product[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const wholeVal = d.wholesalePrice ?? d.buyWholesale ?? null;
        const dozVal = d.dozenPrice ?? d.sellDozenRetail ?? null;
        items.push({
          id: d.id || docSnap.id,
          name: d.name,
          price: d.price,
          category: d.category,
          dozenPrice: dozVal,
          wholesalePrice: wholeVal,
          buyWholesale: wholeVal,
          sellDozenRetail: dozVal,
          image: d.image,
          createdAt: typeof d.createdAt === 'string' ? d.createdAt : undefined,
          updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : undefined,
        });
      });
      onData(items, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
    },
    (error) => {
      onError?.(error);
      if (isPermissionError(error)) {
        handleFirestoreError(error, OperationType.GET, path);
      }
    }
  );
}

// 5. Cloud Product Mutations
export async function cloudSaveProduct(product: Product): Promise<void> {
  const cleanId = sanitizeDocId(product.id);
  const path = `products/${cleanId}`;
  try {
    const docRef = doc(db, 'products', cleanId);
    await setDoc(docRef, sanitizeProduct({ ...product, id: cleanId }), { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function cloudDeleteProduct(productId: string): Promise<void> {
  const cleanId = sanitizeDocId(productId);
  const path = `products/${cleanId}`;
  try {
    const docRef = doc(db, 'products', cleanId);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Batch seed products to cloud (e.g. Initial cloud migration or backup restore)
export async function cloudBatchSeedProducts(products: Product[]): Promise<number> {
  if (!products || products.length === 0) return 0;
  let count = 0;
  const chunkSize = 200;

  try {
    for (let i = 0; i < products.length; i += chunkSize) {
      const chunk = products.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      for (const p of chunk) {
        const cleanId = sanitizeDocId(p.id, `${p.name || ''}_${p.category || ''}`);
        const ref = doc(db, 'products', cleanId);
        batch.set(ref, sanitizeProduct({ ...p, id: cleanId }), { merge: true });
      }
      await batch.commit();
      count += chunk.length;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'products');
  }

  return count;
}

// 6. Real-time Shortages Sync
export function subscribeToShortages(
  onData: (shortages: ShortageItem[], meta: SnapshotMeta) => void,
  onError?: (err: Error) => void
) {
  const path = 'shortages';
  return onSnapshot(
    collection(db, path),
    { includeMetadataChanges: true },
    (snapshot) => {
      const items: ShortageItem[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        items.push({
          id: d.id || docSnap.id,
          name: d.name,
          quantity: d.quantity || 1,
          category: d.category || 'بدون مجموعة',
          done: Boolean(d.done),
          date: d.date || new Date().toISOString(),
          notes: d.notes,
        });
      });
      // Sort newest first
      items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      onData(items, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
    },
    (error) => {
      onError?.(error);
      if (isPermissionError(error)) {
        handleFirestoreError(error, OperationType.GET, path);
      }
    }
  );
}

export async function cloudSaveShortage(shortage: ShortageItem): Promise<void> {
  const cleanId = sanitizeDocId(shortage.id);
  const path = `shortages/${cleanId}`;
  try {
    const docRef = doc(db, 'shortages', cleanId);
    const resolvedName = String(shortage.name || 'صنف ناقص').trim().slice(0, 300) || 'صنف ناقص';
    const resolvedCat = String(shortage.category || '').trim().slice(0, 150) || 'بدون مجموعة';
    const safeQty = Math.max(1, Math.min(10000, Math.round(Number(shortage.quantity) || 1)));
    const safeDate = String(shortage.date || '').trim().slice(0, 64) || new Date().toISOString();
    const data: Record<string, any> = {
      id: cleanId,
      name: resolvedName,
      quantity: safeQty,
      category: resolvedCat,
      done: Boolean(shortage.done),
      date: safeDate,
      updatedAt: new Date().toISOString(),
    };
    if (shortage.notes && shortage.notes.trim()) {
      data.notes = String(shortage.notes).trim().slice(0, 500);
    } else {
      data.notes = deleteField();
    }
    await setDoc(docRef, data, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function cloudDeleteShortage(shortageId: string): Promise<void> {
  const cleanId = sanitizeDocId(shortageId);
  const path = `shortages/${cleanId}`;
  try {
    const docRef = doc(db, 'shortages', cleanId);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Atomic batch deletion of all shortages (prevents race conditions and partial deletes)
export async function cloudBatchDeleteShortages(ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  const chunkSize = 200;
  try {
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      for (const id of chunk) {
        const docRef = doc(db, 'shortages', sanitizeDocId(id));
        batch.delete(docRef);
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'shortages');
  }
}

// Batch seed shortages to cloud (Used during Backup Restore so all shortages appear on all devices)
export async function cloudBatchSeedShortages(shortages: ShortageItem[], wipeExisting = true): Promise<number> {
  if (wipeExisting) {
    try {
      let snap;
      try {
        snap = await getDocs(collection(db, 'shortages'));
      } catch {
        snap = await getDocsFromCache(collection(db, 'shortages'));
      }
      const currentIds = snap.docs.map((d) => d.id);
      if (currentIds.length > 0) {
        await cloudBatchDeleteShortages(currentIds);
      }
    } catch (err) {
      console.warn('Wiping existing cloud shortages before restore warning:', err);
    }
  }

  if (!shortages || shortages.length === 0) return 0;
  let count = 0;
  const chunkSize = 200;

  try {
    for (let i = 0; i < shortages.length; i += chunkSize) {
      const chunk = shortages.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      for (const s of chunk) {
        const cleanId = sanitizeDocId(s.id, s.name);
        const ref = doc(db, 'shortages', cleanId);
        const safeQty = Math.max(1, Math.min(10000, Math.round(Number(s.quantity) || 1)));
        const safeDate = String(s.date || '').trim().slice(0, 64) || new Date().toISOString();
        const data: Record<string, any> = {
          id: cleanId,
          name: String(s.name || 'صنف ناقص').trim().slice(0, 300) || 'صنف ناقص',
          quantity: safeQty,
          category: String(s.category || 'بدون مجموعة').trim().slice(0, 150) || 'بدون مجموعة',
          done: false,
          date: safeDate,
          updatedAt: new Date().toISOString(),
        };
        if (s.notes && s.notes.trim()) {
          data.notes = String(s.notes).trim().slice(0, 500);
        }
        batch.set(ref, data, { merge: true });
      }
      await batch.commit();
      count += chunk.length;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'shortages');
  }

  return count;
}

// 7. Store Settings Cloud Sync
export function subscribeToStoreSettings(
  onData: (settings: StoreSettings, meta: SnapshotMeta) => void,
  onError?: (err: Error) => void
) {
  const path = 'settings/main';
  return onSnapshot(
    doc(db, 'settings', 'main'),
    { includeMetadataChanges: true },
    (docSnap) => {
      if (docSnap.exists()) {
        const d = docSnap.data();
        onData(
          {
            shop: d.shop || 'مكتبة الطيب أحسن',
            phone: d.phone || '01151906520',
            tagline: d.tagline || 'نظام إدارة الأصناف والمبيعات',
            address: d.address || '',
          },
          {
            fromCache: docSnap.metadata.fromCache,
            hasPendingWrites: docSnap.metadata.hasPendingWrites,
          }
        );
      }
    },
    (error) => {
      onError?.(error);
      if (isPermissionError(error)) {
        handleFirestoreError(error, OperationType.GET, path);
      }
    }
  );
}

export async function cloudSaveStoreSettings(settings: StoreSettings): Promise<void> {
  const path = 'settings/main';
  try {
    const docRef = doc(db, 'settings', 'main');
    const safeShop = String(settings.shop || '').trim().slice(0, 200) || 'مكتبة الطيب أحسن';
    const safePhone = String(settings.phone || '').trim().slice(0, 50) || '01151906520';
    await setDoc(docRef, {
      shop: safeShop,
      phone: safePhone,
      tagline: String(settings.tagline || '').trim().slice(0, 200),
      address: String(settings.address || '').trim().slice(0, 300),
      ownerEmail: OWNER_EMAIL,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// 8. Real-time Invoices Cloud Sync
export function subscribeToInvoices(
  onData: (invoices: Invoice[], meta: SnapshotMeta) => void,
  onError?: (err: Error) => void
) {
  const path = 'invoices';
  return onSnapshot(
    collection(db, path),
    { includeMetadataChanges: true },
    (snapshot) => {
      const items: Invoice[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        items.push({
          id: d.id || docSnap.id,
          customer: d.customer || '',
          items: Array.isArray(d.items) ? d.items : [],
          total: Number(d.total) || 0,
          discount: d.discount !== undefined ? Number(d.discount) : undefined,
          notes: d.notes || '',
          date: d.date || new Date().toISOString(),
          updatedAt: d.updatedAt,
        });
      });
      // Sort newest first
      items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      onData(items, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
    },
    (error) => {
      onError?.(error);
      if (isPermissionError(error)) {
        handleFirestoreError(error, OperationType.GET, path);
      }
    }
  );
}

function sanitizeInvoicePayload(invoice: Invoice): Record<string, any> | null {
  const rawItems = Array.isArray(invoice.items)
    ? invoice.items
        .filter((it) => it && typeof it === 'object')
        .slice(0, 500)
        .map((it) => ({
          id: String(it.id || '').slice(0, 128),
          ...(it.productId ? { productId: String(it.productId).slice(0, 128) } : {}),
          name: String(it.name || 'صنف').slice(0, 300),
          price: Math.max(0, Number(it.price) || 0),
          ...(typeof it.originalPrice === 'number' && Number.isFinite(it.originalPrice)
            ? { originalPrice: Math.max(0, Number(it.originalPrice)) }
            : {}),
          quantity: Math.max(1, Math.round(Number(it.quantity) || 1)),
          ...(it.category ? { category: String(it.category).slice(0, 150) } : {}),
          ...(it.unit === 'dozen' || it.unit === 'piece' ? { unit: it.unit } : {}),
        }))
    : [];

  if (rawItems.length === 0) {
    return null;
  }

  const cleanId = sanitizeDocId(invoice.id);
  const safeDate = String(invoice.date || '').trim().slice(0, 64) || new Date().toISOString();
  const data: Record<string, any> = {
    id: cleanId,
    items: rawItems,
    total: Math.max(0, Number(invoice.total) || 0),
    date: safeDate,
    updatedAt: new Date().toISOString(),
  };
  if (invoice.customer && String(invoice.customer).trim()) {
    data.customer = String(invoice.customer).trim().slice(0, 200);
  }
  if (invoice.discount !== undefined && invoice.discount !== null && Number.isFinite(Number(invoice.discount))) {
    data.discount = Math.max(0, Number(invoice.discount));
  }
  if (invoice.notes && String(invoice.notes).trim()) {
    data.notes = String(invoice.notes).trim().slice(0, 500);
  }
  return data;
}

export async function cloudSaveInvoice(invoice: Invoice): Promise<void> {
  const payload = sanitizeInvoicePayload(invoice);
  if (!payload) return;
  const path = `invoices/${payload.id}`;
  try {
    const docRef = doc(db, 'invoices', payload.id);
    await setDoc(docRef, payload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function cloudDeleteInvoice(invoiceId: string): Promise<void> {
  const cleanId = sanitizeDocId(invoiceId);
  const path = `invoices/${cleanId}`;
  try {
    const docRef = doc(db, 'invoices', cleanId);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// Batch seed invoices to cloud (Used during Backup Restore)
export async function cloudBatchSeedInvoices(invoices: Invoice[]): Promise<number> {
  if (!invoices || invoices.length === 0) return 0;
  let count = 0;
  const chunkSize = 200;

  try {
    for (let i = 0; i < invoices.length; i += chunkSize) {
      const chunk = invoices.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      let hasBatchOps = false;
      for (const inv of chunk) {
        const payload = sanitizeInvoicePayload(inv);
        if (!payload) continue;
        const ref = doc(db, 'invoices', payload.id);
        batch.set(ref, payload, { merge: true });
        hasBatchOps = true;
        count++;
      }
      if (hasBatchOps) {
        await batch.commit();
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'invoices');
  }

  return count;
}

// 9. Full Cloud Store Wipe (Owner Only: deletes all docs in products, invoices, and shortages)
export async function cloudWipeAllStoreData(): Promise<void> {
  const collectionsToWipe = ['products', 'shortages', 'invoices'] as const;
  for (const colName of collectionsToWipe) {
    try {
      const snap = await getDocs(collection(db, colName));
      const ids = snap.docs.map((d) => d.id);
      const chunkSize = 200;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const batch = writeBatch(db);
        for (const id of chunk) {
          batch.delete(doc(db, colName, id));
        }
        await batch.commit();
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, colName);
    }
  }
}

// 10. 30-Day Soft-Delete Trash Bin (Owner Only)
function sanitizeTrashPayload(item: TrashItem): Record<string, any> {
  const cleanId = sanitizeDocId(item.id, item.originalId || item.title);
  const data: Record<string, any> = {
    id: cleanId,
    entityType: item.entityType,
    originalId: sanitizeDocId(item.originalId, item.title),
    title: String(item.title || 'عنصر محذوف').trim().slice(0, 300) || 'عنصر محذوف',
    data: item.data && typeof item.data === 'object' ? item.data : {},
    deletedAt: String(item.deletedAt || new Date().toISOString()).slice(0, 64),
    expiresAt: String(item.expiresAt || new Date(Date.now() + 30 * 86400000).toISOString()).slice(0, 64),
  };
  if (item.subtitle && String(item.subtitle).trim()) {
    data.subtitle = String(item.subtitle).trim().slice(0, 300);
  }
  const actor = item.deletedBy || auth.currentUser?.email;
  if (actor && String(actor).trim()) {
    data.deletedBy = String(actor).trim().slice(0, 150);
  }
  return data;
}

export function subscribeToTrashBin(
  onData: (items: TrashItem[], meta: SnapshotMeta) => void,
  onError?: (err: Error) => void
) {
  const path = 'trash_bin';
  return onSnapshot(
    collection(db, path),
    { includeMetadataChanges: true },
    (snapshot) => {
      const items: TrashItem[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        items.push({
          id: d.id || docSnap.id,
          entityType: d.entityType,
          originalId: d.originalId || docSnap.id,
          title: d.title || 'عنصر محذوف',
          subtitle: d.subtitle,
          data: d.data,
          deletedAt: d.deletedAt || new Date().toISOString(),
          expiresAt: d.expiresAt || new Date(Date.now() + 30 * 86400000).toISOString(),
          deletedBy: d.deletedBy,
        });
      });
      items.sort((a, b) => (Date.parse(b.deletedAt) || 0) - (Date.parse(a.deletedAt) || 0));
      onData(items, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
    },
    (error) => {
      onError?.(error);
      if (isPermissionError(error)) {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  );
}

export async function cloudSaveTrashItem(item: TrashItem): Promise<void> {
  const payload = sanitizeTrashPayload(item);
  const path = `trash_bin/${payload.id}`;
  try {
    await setDoc(doc(db, 'trash_bin', payload.id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function cloudBatchSaveTrashItems(items: TrashItem[]): Promise<void> {
  if (!items || items.length === 0) return;
  const chunkSize = 150;
  try {
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      for (const item of chunk) {
        const payload = sanitizeTrashPayload(item);
        batch.set(doc(db, 'trash_bin', payload.id), payload);
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'trash_bin');
  }
}

export async function cloudDeleteTrashItem(trashId: string): Promise<void> {
  const cleanId = sanitizeDocId(trashId);
  const path = `trash_bin/${cleanId}`;
  try {
    await deleteDoc(doc(db, 'trash_bin', cleanId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function cloudBatchDeleteTrashItems(ids: string[]): Promise<void> {
  if (!ids || ids.length === 0) return;
  const chunkSize = 200;
  try {
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      for (const id of chunk) {
        batch.delete(doc(db, 'trash_bin', sanitizeDocId(id)));
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'trash_bin');
  }
}

// 11. Daily & Manual Cloud Backups Vault (Owner Only)
export function subscribeToCloudBackups(
  onData: (manifests: CloudBackupManifest[], meta: SnapshotMeta) => void,
  onError?: (err: Error) => void
) {
  const path = 'cloud_backups';
  return onSnapshot(
    collection(db, path),
    { includeMetadataChanges: true },
    (snapshot) => {
      const list: CloudBackupManifest[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        list.push({
          id: d.id || docSnap.id,
          dateKey: String(d.dateKey || ''),
          label: String(d.label || d.dateKey || docSnap.id),
          reason: d.reason || 'auto_daily',
          productCount: Number(d.productCount) || 0,
          categoryCount: Number(d.categoryCount) || 0,
          invoiceCount: Number(d.invoiceCount) || 0,
          shortageCount: Number(d.shortageCount) || 0,
          chunkCount: Number(d.chunkCount) || 1,
          settings: d.settings,
          createdAt: String(d.createdAt || d.updatedAt || new Date().toISOString()),
          updatedAt: String(d.updatedAt || d.createdAt || new Date().toISOString()),
          createdBy: d.createdBy,
        });
      });
      list.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
      onData(list, {
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
    },
    (error) => {
      onError?.(error);
      if (isPermissionError(error)) {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  );
}

export async function cloudGetDailyBackupManifest(dateKey: string): Promise<CloudBackupManifest | null> {
  const backupId = buildDailyBackupId(dateKey);
  if (!backupId) return null;
  try {
    const snap = await getDoc(doc(db, 'cloud_backups', backupId));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      id: d.id || snap.id,
      dateKey: String(d.dateKey || dateKey),
      label: String(d.label || d.dateKey || snap.id),
      reason: d.reason || 'auto_daily',
      productCount: Number(d.productCount) || 0,
      categoryCount: Number(d.categoryCount) || 0,
      invoiceCount: Number(d.invoiceCount) || 0,
      shortageCount: Number(d.shortageCount) || 0,
      chunkCount: Number(d.chunkCount) || 1,
      settings: d.settings,
      createdAt: String(d.createdAt || d.updatedAt || new Date().toISOString()),
      updatedAt: String(d.updatedAt || d.createdAt || new Date().toISOString()),
      createdBy: d.createdBy,
    };
  } catch {
    return null;
  }
}

export async function cloudSaveBackupSnapshot(
  dbState: AppDatabase,
  options?: { reason?: CloudBackupReason; customId?: string; label?: string }
): Promise<CloudBackupManifest> {
  const reason: CloudBackupReason = options?.reason || 'auto_daily';
  const now = new Date();
  const dateKey = getDailyBackupDateKey(now);
  const backupId = sanitizeDocId(
    options?.customId ||
      (reason === 'auto_daily'
        ? buildDailyBackupId(dateKey)
        : `${reason}_${dateKey.replace(/-/g, '_')}_${now.getTime().toString(36)}`)
  );

  const chunks = buildSnapshotChunks(backupId, dbState);
  const categoryCount = new Set(
    (dbState.products || []).map((p) => (p.category || 'بدون مجموعة').trim() || 'بدون مجموعة')
  ).size;

  const reasonLabels: Record<CloudBackupReason, string> = {
    auto_daily: `النسخة اليومية التلقائية (${dateKey})`,
    manual: `نسخة سحابية يدوية (${dateKey})`,
    pre_wipe: `نسخة أمان تلقائية قبل تفريغ المتجر (${dateKey})`,
    pre_restore: `نسخة أمان تلقائية قبل الاستعادة (${dateKey})`,
  };
  const label = String(options?.label || reasonLabels[reason]).slice(0, 200);
  const manifestRef = doc(db, 'cloud_backups', backupId);

  try {
    let createdAt = now.toISOString();
    try {
      const existingSnap = await getDoc(manifestRef);
      if (existingSnap.exists() && typeof existingSnap.data().createdAt === 'string') {
        createdAt = existingSnap.data().createdAt;
      }
    } catch {
      // Proceed cleanly with new timestamp if doc does not exist yet
    }

    const updatedAt = now.toISOString();
    const manifestPayload: Record<string, any> = {
      id: backupId,
      dateKey,
      label,
      reason,
      productCount: dbState.products?.length || 0,
      categoryCount,
      invoiceCount: dbState.invoices?.length || 0,
      shortageCount: dbState.shortages?.length || 0,
      chunkCount: chunks.length,
      settings: {
        shop: String(dbState.settings?.shop || 'مكتبة الطيب أحسن').slice(0, 200),
        phone: String(dbState.settings?.phone || '01151906520').slice(0, 50),
        tagline: String(dbState.settings?.tagline || '').slice(0, 200),
        address: String(dbState.settings?.address || '').slice(0, 300),
      },
      createdAt,
      updatedAt,
    };
    if (auth.currentUser?.email) {
      manifestPayload.createdBy = String(auth.currentUser.email).slice(0, 150);
    }

    // 1. Write parent manifest first so Master Gate exists() passes for all subcollection chunks
    await setDoc(manifestRef, manifestPayload);

    // 2. Write bounded chunks in small batches
    const chunkBatchLimit = 10;
    for (let i = 0; i < chunks.length; i += chunkBatchLimit) {
      const subBatch = writeBatch(db);
      const slice = chunks.slice(i, i + chunkBatchLimit);
      for (const ch of slice) {
        const chRef = doc(db, 'cloud_backups', backupId, 'chunks', ch.id);
        subBatch.set(chRef, ch);
      }
      await subBatch.commit();
    }

    // 3. Clean up any stale excess chunks when Owner is signed in
    const isSignedInOwner = Boolean(
      auth.currentUser?.emailVerified &&
        auth.currentUser.email?.toLowerCase() === OWNER_EMAIL.toLowerCase()
    );
    if (isSignedInOwner) {
      try {
        const oldChunksSnap = await getDocs(collection(db, 'cloud_backups', backupId, 'chunks'));
        const staleDocs = oldChunksSnap.docs.filter((d) => {
          const idx = Number(d.data()?.chunkIndex);
          return !Number.isFinite(idx) || idx >= chunks.length;
        });
        if (staleDocs.length > 0) {
          const cleanBatch = writeBatch(db);
          staleDocs.forEach((d) => cleanBatch.delete(d.ref));
          await cleanBatch.commit();
        }
      } catch {
        // Non-critical stale cleanup
      }
    }

    return manifestPayload as CloudBackupManifest;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `cloud_backups/${backupId}`);
  }
}

export async function cloudLoadBackupSnapshot(
  manifest: CloudBackupManifest,
  fallbackSettings: StoreSettings
): Promise<AppDatabase> {
  const path = `cloud_backups/${manifest.id}/chunks`;
  try {
    const snap = await getDocs(collection(db, 'cloud_backups', manifest.id, 'chunks'));
    const chunks: CloudBackupChunk[] = snap.docs.map((docSnap) => {
      const d = docSnap.data();
      return {
        id: d.id || docSnap.id,
        backupId: d.backupId || manifest.id,
        chunkIndex: Number(d.chunkIndex) || 0,
        products: Array.isArray(d.products) ? d.products : [],
        invoices: Array.isArray(d.invoices) ? d.invoices : [],
        shortages: Array.isArray(d.shortages) ? d.shortages : [],
      };
    });
    return reassembleDatabaseFromBackup(manifest, chunks, fallbackSettings);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function cloudDeleteBackupSnapshot(backupId: string): Promise<void> {
  const cleanId = sanitizeDocId(backupId);
  const path = `cloud_backups/${cleanId}`;
  try {
    const chunksSnap = await getDocs(collection(db, 'cloud_backups', cleanId, 'chunks'));
    if (!chunksSnap.empty) {
      const chunkSize = 200;
      for (let i = 0; i < chunksSnap.docs.length; i += chunkSize) {
        const batch = writeBatch(db);
        chunksSnap.docs.slice(i, i + chunkSize).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }
    await deleteDoc(doc(db, 'cloud_backups', cleanId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface ForceCloudRefreshResult {
  ok: boolean;
  reason?: 'offline' | 'unauthenticated' | 'timeout' | 'network_error';
  error?: string;
  syncedAt?: string;
  products?: Product[];
  shortages?: ShortageItem[];
  invoices?: Invoice[];
  settings?: StoreSettings | null;
  trash?: TrashItem[];
  cloudBackups?: CloudBackupManifest[];
}

/**
 * Forces an authoritative server read from Firestore (bypassing stale local cache)
 * so opening the app or tapping "تحديث الآن" guarantees the newest cloud prices & items.
 */
export async function forceCloudSyncRefresh(options?: {
  isCloudAdmin?: boolean;
  timeoutMs?: number;
}): Promise<ForceCloudRefreshResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, reason: 'offline' };
  }

  const perCallTimeout = options?.timeoutMs ?? 9000;

  try {
    await withTimeout(enableNetwork(db), 2500, 'enableNetwork').catch(() => {});

    const [productsSnap, shortagesSnap, invoicesSnap, settingsSnap] = await Promise.all([
      withTimeout(getDocsFromServer(collection(db, 'products')), perCallTimeout, 'products:server'),
      withTimeout(getDocsFromServer(collection(db, 'shortages')), perCallTimeout, 'shortages:server'),
      withTimeout(getDocsFromServer(collection(db, 'invoices')), perCallTimeout, 'invoices:server'),
      withTimeout(getDocFromServer(doc(db, 'settings', 'main')), perCallTimeout, 'settings:server').catch(() => null),
    ]);

    const products: Product[] = productsSnap.docs.map((docSnap) => {
      const d = docSnap.data();
      const wholeVal = d.wholesalePrice ?? d.buyWholesale ?? null;
      const dozVal = d.dozenPrice ?? d.sellDozenRetail ?? null;
      return {
        id: d.id || docSnap.id,
        name: d.name,
        price: d.price,
        category: d.category,
        dozenPrice: dozVal,
        wholesalePrice: wholeVal,
        buyWholesale: wholeVal,
        sellDozenRetail: dozVal,
        image: d.image,
        createdAt: typeof d.createdAt === 'string' ? d.createdAt : undefined,
        updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : undefined,
      };
    });

    const shortages: ShortageItem[] = shortagesSnap.docs
      .map((docSnap) => {
        const d = docSnap.data();
        return {
          id: d.id || docSnap.id,
          name: d.name,
          quantity: d.quantity || 1,
          category: d.category || 'بدون مجموعة',
          done: Boolean(d.done),
          date: d.date || new Date().toISOString(),
          notes: d.notes,
        };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const invoices: Invoice[] = invoicesSnap.docs
      .map((docSnap) => {
        const d = docSnap.data();
        return {
          id: d.id || docSnap.id,
          customer: d.customer || '',
          items: Array.isArray(d.items) ? d.items : [],
          total: Number(d.total) || 0,
          discount: d.discount !== undefined ? Number(d.discount) : undefined,
          notes: d.notes || '',
          date: d.date || new Date().toISOString(),
          updatedAt: d.updatedAt,
        };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    let settings: StoreSettings | null = null;
    if (settingsSnap && settingsSnap.exists()) {
      const d = settingsSnap.data();
      settings = {
        shop: d.shop || 'مكتبة الطيب أحسن',
        phone: d.phone || '01151906520',
        tagline: d.tagline || 'نظام إدارة الأصناف والمبيعات',
        address: d.address || '',
      };
    }

    let trash: TrashItem[] | undefined;
    let cloudBackups: CloudBackupManifest[] | undefined;
    if (options?.isCloudAdmin) {
      const [trashSnap, backupsSnap] = await Promise.all([
        withTimeout(getDocsFromServer(collection(db, 'trash_bin')), perCallTimeout, 'trash:server').catch(() => null),
        withTimeout(getDocsFromServer(collection(db, 'cloud_backups')), perCallTimeout, 'backups:server').catch(() => null),
      ]);

      if (trashSnap) {
        trash = trashSnap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return {
              id: d.id || docSnap.id,
              entityType: d.entityType,
              originalId: d.originalId || docSnap.id,
              title: d.title || 'عنصر محذوف',
              subtitle: d.subtitle,
              data: d.data,
              deletedAt: d.deletedAt || new Date().toISOString(),
              expiresAt: d.expiresAt || new Date(Date.now() + 30 * 86400000).toISOString(),
              deletedBy: d.deletedBy,
            } as TrashItem;
          })
          .sort((a, b) => (Date.parse(b.deletedAt) || 0) - (Date.parse(a.deletedAt) || 0));
      }

      if (backupsSnap) {
        cloudBackups = backupsSnap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return {
              id: d.id || docSnap.id,
              dateKey: String(d.dateKey || ''),
              label: String(d.label || d.dateKey || docSnap.id),
              reason: d.reason || 'auto_daily',
              productCount: Number(d.productCount) || 0,
              categoryCount: Number(d.categoryCount) || 0,
              invoiceCount: Number(d.invoiceCount) || 0,
              shortageCount: Number(d.shortageCount) || 0,
              chunkCount: Number(d.chunkCount) || 1,
              settings: d.settings,
              createdAt: String(d.createdAt || d.updatedAt || new Date().toISOString()),
              updatedAt: String(d.updatedAt || d.createdAt || new Date().toISOString()),
              createdBy: d.createdBy,
            } as CloudBackupManifest;
          })
          .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
      }
    }

    return {
      ok: true,
      syncedAt: new Date().toISOString(),
      products,
      shortages,
      invoices,
      settings,
      trash,
      cloudBackups,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.includes('sync-timeout');
    return {
      ok: false,
      reason: isTimeout ? 'timeout' : 'network_error',
      error: message,
    };
  }
}

