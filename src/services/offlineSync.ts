import { useEffect, useState } from 'react';
import { Invoice, Product, ShortageItem, StoreSettings, TrashItem } from '../types';
import {
  canExecuteOutboxOp,
  getRetryBackoffMs,
  isCollaborativeSyncOp,
  isPermissionDeniedError,
  LastSyncInfo,
  readLastSyncInfo,
  recordLastSyncInfo,
  SyncSource,
} from '../utils/syncLogic';
import {
  auth,
  cloudBatchDeleteShortages,
  cloudBatchDeleteTrashItems,
  cloudBatchSaveTrashItems,
  cloudBatchSeedInvoices,
  cloudBatchSeedProducts,
  cloudBatchSeedShortages,
  cloudDeleteInvoice,
  cloudDeleteProduct,
  cloudDeleteShortage,
  cloudDeleteTrashItem,
  cloudSaveInvoice,
  cloudSaveProduct,
  cloudSaveShortage,
  cloudSaveStoreSettings,
  cloudSaveTrashItem,
  cloudWipeAllStoreData,
  reconnectFirestore,
} from './firebase';

const LEGACY_OUTBOX_KEY = 'tayeb_offline_outbox_v1';
const OUTBOX_IDB_NAME = 'tayeb_offline_outbox_db_v1';
const OUTBOX_IDB_STORE = 'ops';
const OUTBOX_RECORD_KEY = 'queue';

const SINGLE_OP_TIMEOUT_MS = 15000;
const BATCH_OP_TIMEOUT_MS = 45000;
const FLUSH_OVERALL_TIMEOUT_MS = 90000;

export type OutboxOp =
  | { key: string; type: 'saveProduct'; payload: Product; ts: number }
  | { key: string; type: 'deleteProduct'; id: string; ts: number }
  | { key: string; type: 'saveShortage'; payload: ShortageItem; ts: number }
  | { key: string; type: 'deleteShortage'; id: string; ts: number }
  | { key: string; type: 'saveInvoice'; payload: Invoice; ts: number }
  | { key: string; type: 'deleteInvoice'; id: string; ts: number }
  | { key: string; type: 'saveSettings'; payload: StoreSettings; ts: number }
  | { key: string; type: 'batchSeedProducts'; payload: Product[]; ts: number }
  | { key: string; type: 'batchSeedShortages'; payload: ShortageItem[]; wipeExisting: boolean; ts: number }
  | { key: string; type: 'batchSeedInvoices'; payload: Invoice[]; ts: number }
  | { key: string; type: 'wipeStoreData'; ts: number }
  | { key: string; type: 'saveTrashItem'; payload: TrashItem; ts: number }
  | { key: string; type: 'batchSaveTrashItems'; payload: TrashItem[]; ts: number }
  | { key: string; type: 'deleteTrashItem'; id: string; ts: number }
  | { key: string; type: 'batchDeleteTrashItems'; ids: string[]; ts: number };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type OutboxOpInput = DistributiveOmit<OutboxOp, 'ts'>;

export interface SyncStatusState {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  justSyncedCount: number;
  lastSyncAt: string | null;
  lastSyncSource: SyncSource | null;
  lastError: string | null;
  retryAttempt: number;
  nextRetryAt: number | null;
}

type SyncListener = (status: SyncStatusState) => void;

const listeners = new Set<SyncListener>();
let outboxMap = new Map<string, OutboxOp>();
let isSyncingFlag = false;
let justSyncedCount = 0;
let justSyncedTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
let nextRetryAt: number | null = null;
let lastError: string | null = null;
let lastSyncState: LastSyncInfo = readLastSyncInfo();
let flushInFlight: Promise<void> | null = null;
let outboxInitPromise: Promise<void> | null = null;
let persistChain: Promise<void> = Promise.resolve();
let cloudAdminActive = false;

export function setOfflineSyncCloudAdmin(isAdmin: boolean): void {
  const prev = cloudAdminActive;
  cloudAdminActive = Boolean(isAdmin);
  if (cloudAdminActive && !prev && outboxMap.size > 0 && typeof navigator !== 'undefined' && navigator.onLine) {
    void flushOfflineOutbox(true);
  }
}

function withOpTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
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

function getOpTimeoutMs(op: OutboxOp): number {
  switch (op.type) {
    case 'batchSeedProducts':
    case 'batchSeedShortages':
    case 'batchSeedInvoices':
    case 'wipeStoreData':
    case 'batchSaveTrashItems':
    case 'batchDeleteTrashItems':
      return BATCH_OP_TIMEOUT_MS;
    default:
      return SINGLE_OP_TIMEOUT_MS;
  }
}

function openOutboxIdb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(OUTBOX_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OUTBOX_IDB_STORE)) {
          db.createObjectStore(OUTBOX_IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function persistOutboxToIdb(ops: OutboxOp[]): Promise<void> {
  try {
    const db = await openOutboxIdb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(OUTBOX_IDB_STORE, 'readwrite');
      tx.objectStore(OUTBOX_IDB_STORE).put(ops, OUTBOX_RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore IDB write failures
  }
}

async function initOutboxFromStorage(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    // 1. Migrate any legacy localStorage outbox out of the 5MB localStorage quota
    const legacyRaw = localStorage.getItem(LEGACY_OUTBOX_KEY);
    if (legacyRaw) {
      try {
        const arr = JSON.parse(legacyRaw);
        if (Array.isArray(arr)) {
          for (const op of arr) {
            if (op && typeof op.key === 'string' && !outboxMap.has(op.key)) {
              outboxMap.set(op.key, op);
            }
          }
        }
      } catch {
        // Ignore corrupt legacy JSON
      }
      localStorage.removeItem(LEGACY_OUTBOX_KEY);
    }

    // 2. Load IndexedDB outbox safely without clobbering newer in-memory mutations
    const db = await openOutboxIdb();
    if (db) {
      const saved = await new Promise<OutboxOp[] | null>((resolve) => {
        const tx = db.transaction(OUTBOX_IDB_STORE, 'readonly');
        const req = tx.objectStore(OUTBOX_IDB_STORE).get(OUTBOX_RECORD_KEY);
        req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as OutboxOp[]) : null);
        req.onerror = () => resolve(null);
      });
      if (saved) {
        for (const op of saved) {
          if (op && typeof op.key === 'string') {
            const cur = outboxMap.get(op.key);
            if (!cur || op.ts > cur.ts) {
              outboxMap.set(op.key, op);
            }
          }
        }
      }
    }

    if (outboxMap.size > 0) {
      await persistOutboxToIdb(Array.from(outboxMap.values()));
      notifyListeners();
    }
  } catch (err) {
    console.warn('Could not load offline outbox:', err);
  }
}

function ensureOutboxReady(): Promise<void> {
  if (!outboxInitPromise) {
    outboxInitPromise = initOutboxFromStorage();
  }
  return outboxInitPromise;
}

function persistOutboxToStorage(): void {
  if (typeof window === 'undefined') return;
  const snapshot = Array.from(outboxMap.values());
  persistChain = persistChain
    .then(() => persistOutboxToIdb(snapshot))
    .catch(() => {});
  try {
    localStorage.removeItem(LEGACY_OUTBOX_KEY);
  } catch {
    // Ignore
  }
}

void ensureOutboxReady();

export async function waitForOutboxReady(): Promise<void> {
  await ensureOutboxReady();
}

export function hasPendingOutboxKey(key: string): boolean {
  return outboxMap.has(key);
}

export function hasPendingOutboxPrefix(prefix: string): boolean {
  for (const key of outboxMap.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

export function getPendingOutboxOps(): OutboxOp[] {
  return Array.from(outboxMap.values()).sort((a, b) => a.ts - b.ts);
}

export function markCloudSyncCompleted(
  source: SyncSource,
  counts?: { productCount?: number; invoiceCount?: number; shortageCount?: number }
): LastSyncInfo {
  lastSyncState = recordLastSyncInfo(source, counts);
  if (source !== 'offline_cached') {
    lastError = null;
    retryAttempt = 0;
    nextRetryAt = null;
  }
  notifyListeners();
  return lastSyncState;
}

export function getSyncStatus(): SyncStatusState {
  return {
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pendingCount: outboxMap.size,
    isSyncing: isSyncingFlag,
    justSyncedCount,
    lastSyncAt: lastSyncState.lastSyncAt,
    lastSyncSource: lastSyncState.source,
    lastError,
    retryAttempt,
    nextRetryAt,
  };
}

function notifyListeners(): void {
  const status = getSyncStatus();
  listeners.forEach((cb) => cb(status));
}

export function subscribeToSyncStatus(listener: SyncListener): () => void {
  listeners.add(listener);
  listener(getSyncStatus());
  return () => {
    listeners.delete(listener);
  };
}

function clearRetryTimer(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  nextRetryAt = null;
}

function hasEligibleOpsToFlush(): boolean {
  for (const op of outboxMap.values()) {
    if (canExecuteOutboxOp(op, cloudAdminActive)) {
      return true;
    }
  }
  return false;
}

function scheduleOutboxRetry(): void {
  if (typeof window === 'undefined') return;
  clearRetryTimer();
  if (!navigator.onLine || !hasEligibleOpsToFlush()) {
    return;
  }
  const delay = getRetryBackoffMs(retryAttempt);
  retryAttempt = Math.min(retryAttempt + 1, 6);
  nextRetryAt = Date.now() + delay;
  notifyListeners();

  retryTimer = setTimeout(() => {
    retryTimer = null;
    nextRetryAt = null;
    if (navigator.onLine && hasEligibleOpsToFlush()) {
      void flushOfflineOutbox(true, retryAttempt >= 2);
    }
  }, delay);
}

function markJustSynced(count: number): void {
  if (count <= 0) return;
  justSyncedCount = count;
  if (justSyncedTimer) clearTimeout(justSyncedTimer);
  notifyListeners();
  justSyncedTimer = setTimeout(() => {
    justSyncedCount = 0;
    notifyListeners();
  }, 4500);
}

async function executeOp(op: OutboxOp): Promise<void> {
  switch (op.type) {
    case 'saveProduct':
      await cloudSaveProduct(op.payload);
      return;
    case 'deleteProduct':
      await cloudDeleteProduct(op.id);
      return;
    case 'saveShortage':
      await cloudSaveShortage(op.payload);
      return;
    case 'deleteShortage':
      await cloudDeleteShortage(op.id);
      return;
    case 'saveInvoice':
      await cloudSaveInvoice(op.payload);
      return;
    case 'deleteInvoice':
      await cloudDeleteInvoice(op.id);
      return;
    case 'saveSettings':
      await cloudSaveStoreSettings(op.payload);
      return;
    case 'batchSeedProducts':
      await cloudBatchSeedProducts(op.payload);
      return;
    case 'batchSeedShortages':
      await cloudBatchSeedShortages(op.payload, op.wipeExisting);
      return;
    case 'batchSeedInvoices':
      await cloudBatchSeedInvoices(op.payload);
      return;
    case 'wipeStoreData':
      await cloudWipeAllStoreData();
      return;
    case 'saveTrashItem':
      await cloudSaveTrashItem(op.payload);
      return;
    case 'batchSaveTrashItems':
      await cloudBatchSaveTrashItems(op.payload);
      return;
    case 'deleteTrashItem':
      await cloudDeleteTrashItem(op.id);
      return;
    case 'batchDeleteTrashItems':
      await cloudBatchDeleteTrashItems(op.ids);
      return;
  }
}

/**
 * Determines whether an error should drop an outbox op permanently.
 * CRITICAL: Never drop pending ops on permission-denied / unauthenticated / timeout errors!
 * Only drop strictly malformed invalid-argument payloads when authenticated.
 */
export function shouldDropFailedSyncOp(err: unknown, hasAuthenticatedUser: boolean): boolean {
  if (!hasAuthenticatedUser) return false;
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes('invalid-argument');
}

/**
 * Queues a mutation locally immediately in IndexedDB so offline/pre-auth edits survive reloads,
 * and pushes to Firestore immediately when online (collaborative ops work on ANY device;
 * owner-only ops push automatically once Owner Gmail is verified).
 */
export function enqueueSyncOp(op: OutboxOpInput): void {
  const fullOp = { ...op, ts: Date.now() } as OutboxOp;

  if (fullOp.type === 'batchSeedShortages') {
    for (const k of Array.from(outboxMap.keys())) {
      if (k.startsWith('shortages:')) {
        outboxMap.delete(k);
      }
    }
  }

  if (fullOp.type === 'wipeStoreData') {
    for (const k of Array.from(outboxMap.keys())) {
      if (
        k.startsWith('products:') ||
        k.startsWith('shortages:') ||
        k.startsWith('invoices:') ||
        k === 'batch:products' ||
        k === 'batch:shortages' ||
        k === 'batch:invoices'
      ) {
        outboxMap.delete(k);
      }
    }
  }

  outboxMap.set(fullOp.key, fullOp);
  persistOutboxToStorage();
  notifyListeners();

  // Do not fire doomed writes while offline or if op strictly requires Owner authorization not active yet
  if (
    (typeof navigator !== 'undefined' && !navigator.onLine) ||
    !canExecuteOutboxOp(fullOp, cloudAdminActive)
  ) {
    return;
  }

  withOpTimeout(executeOp(fullOp), getOpTimeoutMs(fullOp), fullOp.key)
    .then(() => {
      const current = outboxMap.get(fullOp.key);
      if (current && current.ts === fullOp.ts) {
        outboxMap.delete(fullOp.key);
        persistOutboxToStorage();
        lastError = null;
        retryAttempt = 0;
        clearRetryTimer();
        lastSyncState = recordLastSyncInfo('cloud_push');
        notifyListeners();
      }
    })
    .catch((err) => {
      if (isPermissionDeniedError(err) && !cloudAdminActive) {
        console.warn(`Deferred op [${fullOp.key}] pending Owner authorization:`, err);
        lastError = 'هذا التعديل بانتظار تسجيل دخول المالك بالحساب السحابي';
        notifyListeners();
        return;
      }
      console.warn(`Queued offline op [${fullOp.key}] for retry:`, err);
      lastError = 'تعذر رفع بعض التعديلات حالياً — ستتم إعادة المحاولة تلقائياً';
      scheduleOutboxRetry();
    });
}

/**
 * Helper for batch deleting shortages cleanly while maintaining per-item outbox coalescing.
 */
export function enqueueBatchDeleteShortages(ids: string[]): void {
  if (!ids || ids.length === 0) return;
  const now = Date.now();
  for (const id of ids) {
    const key = `shortages:${id}`;
    outboxMap.set(key, { key, type: 'deleteShortage', id, ts: now });
  }
  persistOutboxToStorage();
  notifyListeners();

  if ((typeof navigator !== 'undefined' && !navigator.onLine) || !cloudAdminActive) {
    return;
  }

  withOpTimeout(cloudBatchDeleteShortages(ids), BATCH_OP_TIMEOUT_MS, 'batch:deleteShortages')
    .then(() => {
      let changed = false;
      for (const id of ids) {
        const key = `shortages:${id}`;
        const cur = outboxMap.get(key);
        if (cur && cur.ts === now) {
          outboxMap.delete(key);
          changed = true;
        }
      }
      if (changed) {
        persistOutboxToStorage();
        lastError = null;
        retryAttempt = 0;
        clearRetryTimer();
        lastSyncState = recordLastSyncInfo('cloud_push');
        notifyListeners();
      }
    })
    .catch((err) => {
      console.warn('Queued batch delete shortages for retry:', err);
      lastError = 'بعض عمليات الحذف بانتظار استقرار الشبكة';
      scheduleOutboxRetry();
    });
}

/**
 * Flushes all eligible queued operations once connectivity is active.
 * Collaborative operations flush from ANY unlocked device; Owner-only ops wait for Owner Gmail session.
 */
export async function flushOfflineOutbox(forceReconnect = false, forceCycleSocket = false): Promise<void> {
  await ensureOutboxReady();

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    notifyListeners();
    return;
  }

  if (flushInFlight) return flushInFlight;

  flushInFlight = (async () => {
    clearRetryTimer();

    if (!hasEligibleOpsToFlush()) {
      if (forceReconnect) {
        await reconnectFirestore(forceCycleSocket);
      }
      if (outboxMap.size === 0) {
        lastError = null;
        retryAttempt = 0;
      }
      notifyListeners();
      return;
    }

    isSyncingFlag = true;
    notifyListeners();

    let syncedCount = 0;
    let hadRetryableFailure = false;

    const runFlush = async () => {
      if (forceReconnect) {
        await reconnectFirestore(forceCycleSocket);
      }

      const ops = Array.from(outboxMap.values()).sort((a, b) => a.ts - b.ts);
      for (const op of ops) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          hadRetryableFailure = true;
          break;
        }
        if (!canExecuteOutboxOp(op, cloudAdminActive)) {
          continue;
        }
        try {
          await withOpTimeout(executeOp(op), getOpTimeoutMs(op), op.key);
          const current = outboxMap.get(op.key);
          if (current && current.ts === op.ts) {
            outboxMap.delete(op.key);
            syncedCount++;
          }
        } catch (err) {
          const canDropContext = Boolean(auth.currentUser) || isCollaborativeSyncOp(op);
          if (shouldDropFailedSyncOp(err, canDropContext)) {
            console.error(`Dropped invalid sync op [${op.key}]:`, err);
            const current = outboxMap.get(op.key);
            if (current && current.ts === op.ts) {
              outboxMap.delete(op.key);
            }
          } else if (isPermissionDeniedError(err) && !cloudAdminActive) {
            console.warn(`Deferred op [${op.key}] awaiting Owner cloud auth:`, err);
          } else {
            hadRetryableFailure = true;
            console.warn(`Retry queued for op [${op.key}]:`, err);
          }
        }
      }
      persistOutboxToStorage();
    };

    try {
      await withOpTimeout(runFlush(), FLUSH_OVERALL_TIMEOUT_MS, 'flushOfflineOutbox');
      if (syncedCount > 0) {
        lastSyncState = recordLastSyncInfo('cloud_push');
      }
      if (outboxMap.size === 0 && !hadRetryableFailure) {
        lastError = null;
        retryAttempt = 0;
      } else if (hasEligibleOpsToFlush() && hadRetryableFailure && navigator.onLine) {
        lastError = 'ما زال هناك تعديلات بانتظار استقرار الشبكة — ستتم إعادة المحاولة تلقائياً';
        scheduleOutboxRetry();
      }
    } catch (err) {
      console.warn('Offline outbox flush timed out cleanly:', err);
      lastError = 'انتهت مهلة المزامنة بسبب ضعف الشبكة — ستتم المحاولة تلقائياً';
      if (hasEligibleOpsToFlush() && navigator.onLine) {
        scheduleOutboxRetry();
      }
    } finally {
      isSyncingFlag = false;
      flushInFlight = null;
      if (syncedCount > 0) {
        markJustSynced(syncedCount);
      } else {
        notifyListeners();
      }
    }
  })();

  return flushInFlight;
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    retryAttempt = 0;
    clearRetryTimer();
    lastError = null;
    notifyListeners();
    setTimeout(() => {
      flushOfflineOutbox(true, true).catch(() => {});
    }, 400);
  });

  window.addEventListener('offline', () => {
    clearRetryTimer();
    notifyListeners();
  });

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine && hasEligibleOpsToFlush()) {
        flushOfflineOutbox(true).catch(() => {});
      }
    });
  }

  window.addEventListener('focus', () => {
    if (navigator.onLine && hasEligibleOpsToFlush() && !isSyncingFlag) {
      flushOfflineOutbox(false).catch(() => {});
    }
  });

  const navWithConnection = navigator as Navigator & {
    connection?: { addEventListener?: (ev: string, cb: () => void) => void };
  };
  navWithConnection.connection?.addEventListener?.('change', () => {
    if (navigator.onLine && hasEligibleOpsToFlush() && !isSyncingFlag) {
      flushOfflineOutbox(true).catch(() => {});
    }
  });
}

export function useSyncStatus(): SyncStatusState {
  const [status, setStatus] = useState<SyncStatusState>(() => getSyncStatus());

  useEffect(() => {
    void ensureOutboxReady();
    return subscribeToSyncStatus(setStatus);
  }, []);

  return status;
}
