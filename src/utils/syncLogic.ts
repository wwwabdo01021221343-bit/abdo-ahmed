import {
  AppDatabase,
  Invoice,
  Product,
  ShortageItem,
  StoreSettings,
  TrashItem,
} from '../types';

export type SyncSource = 'cloud_pull' | 'cloud_push' | 'offline_cached';

export interface LastSyncInfo {
  lastSyncAt: string | null;
  source: SyncSource | null;
  productCount?: number;
  invoiceCount?: number;
  shortageCount?: number;
}

export interface FormattedLastUpdated {
  primary: string;
  relative: string;
  exact: string;
  hasSyncedBefore: boolean;
}

export type PendingOverlayOp =
  | { key: string; type: 'saveProduct'; payload: Product; ts: number }
  | { key: string; type: 'deleteProduct'; id: string; ts: number }
  | { key: string; type: 'saveShortage'; payload: ShortageItem; ts: number }
  | { key: string; type: 'deleteShortage'; id: string; ts: number }
  | { key: string; type: 'saveInvoice'; payload: Invoice; ts: number }
  | { key: string; type: 'deleteInvoice'; id: string; ts: number }
  | { key: string; type: 'saveSettings'; payload: StoreSettings; ts: number }
  | { key: string; type: 'batchSeedProducts'; payload: Product[]; ts: number }
  | {
      key: string;
      type: 'batchSeedShortages';
      payload: ShortageItem[];
      wipeExisting: boolean;
      ts: number;
    }
  | { key: string; type: 'batchSeedInvoices'; payload: Invoice[]; ts: number }
  | { key: string; type: 'wipeStoreData'; ts: number }
  | { key: string; type: 'saveTrashItem'; payload: TrashItem; ts: number }
  | { key: string; type: 'batchSaveTrashItems'; payload: TrashItem[]; ts: number }
  | { key: string; type: 'deleteTrashItem'; id: string; ts: number }
  | { key: string; type: 'batchDeleteTrashItems'; ids: string[]; ts: number };

export const LAST_SYNC_STORAGE_KEY = 'tayeb_last_sync_at_v1';

const RETRY_BACKOFF_STEPS_MS = [5000, 15000, 30000, 60000];

export function getRetryBackoffMs(attempt: number): number {
  const safeIdx = Math.max(0, Math.min(RETRY_BACKOFF_STEPS_MS.length - 1, Math.floor(attempt)));
  return RETRY_BACKOFF_STEPS_MS[safeIdx];
}

export function readLastSyncInfo(): LastSyncInfo {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return { lastSyncAt: null, source: null };
  }
  try {
    const raw = localStorage.getItem(LAST_SYNC_STORAGE_KEY);
    if (!raw) return { lastSyncAt: null, source: null };
    const parsed = JSON.parse(raw) as Partial<LastSyncInfo>;
    if (!parsed || typeof parsed.lastSyncAt !== 'string' || !Number.isFinite(Date.parse(parsed.lastSyncAt))) {
      return { lastSyncAt: null, source: null };
    }
    const source: SyncSource | null =
      parsed.source === 'cloud_pull' ||
      parsed.source === 'cloud_push' ||
      parsed.source === 'offline_cached'
        ? parsed.source
        : null;
    return {
      lastSyncAt: parsed.lastSyncAt,
      source,
      productCount: typeof parsed.productCount === 'number' ? parsed.productCount : undefined,
      invoiceCount: typeof parsed.invoiceCount === 'number' ? parsed.invoiceCount : undefined,
      shortageCount: typeof parsed.shortageCount === 'number' ? parsed.shortageCount : undefined,
    };
  } catch {
    return { lastSyncAt: null, source: null };
  }
}

export function recordLastSyncInfo(
  source: SyncSource,
  counts?: { productCount?: number; invoiceCount?: number; shortageCount?: number },
  timestampIso = new Date().toISOString()
): LastSyncInfo {
  const prev = readLastSyncInfo();
  const next: LastSyncInfo = {
    lastSyncAt: timestampIso,
    source,
    productCount: counts?.productCount ?? prev.productCount,
    invoiceCount: counts?.invoiceCount ?? prev.invoiceCount,
    shortageCount: counts?.shortageCount ?? prev.shortageCount,
  };
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(LAST_SYNC_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota errors
    }
  }
  return next;
}

function formatTime12Ar(date: Date): string {
  const hours24 = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const period = hours24 >= 12 ? 'م' : 'ص';
  const hours12 = String(hours24 % 12 || 12).padStart(2, '0');
  return `${hours12}:${minutes} ${period}`;
}

function formatDateDmy(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatRelativeMinutesAr(diffMin: number): string {
  if (diffMin === 1) return 'منذ دقيقة واحدة';
  if (diffMin === 2) return 'منذ دقيقتين';
  if (diffMin <= 10) return `منذ ${diffMin} دقائق`;
  return `منذ ${diffMin} دقيقة`;
}

function formatRelativeHoursAr(diffHours: number): string {
  if (diffHours === 1) return 'منذ ساعة واحدة';
  if (diffHours === 2) return 'منذ ساعتين';
  if (diffHours <= 10) return `منذ ${diffHours} ساعات`;
  return `منذ ${diffHours} ساعة`;
}

export function formatLastUpdatedLabel(
  isoTimestamp: string | null | undefined,
  nowMs = Date.now()
): FormattedLastUpdated {
  if (!isoTimestamp || typeof isoTimestamp !== 'string') {
    return {
      primary: 'لم تتم المزامنة السحابية بعد',
      relative: 'بانتظار أول مزامنة',
      exact: '—',
      hasSyncedBefore: false,
    };
  }

  const targetMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(targetMs)) {
    return {
      primary: 'لم تتم المزامنة السحابية بعد',
      relative: 'بانتظار أول مزامنة',
      exact: '—',
      hasSyncedBefore: false,
    };
  }

  const targetDate = new Date(targetMs);
  const nowDate = new Date(nowMs);
  const yesterdayDate = new Date(nowDate);
  yesterdayDate.setDate(nowDate.getDate() - 1);

  const timeStr = formatTime12Ar(targetDate);
  const dateStr = formatDateDmy(targetDate);
  const exact = `${dateStr} · ${timeStr}`;

  const diffMs = Math.max(0, nowMs - targetMs);
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);

  let relative: string;
  if (diffSec < 60) {
    relative = 'منذ لحظات';
  } else if (diffMin < 60) {
    relative = formatRelativeMinutesAr(diffMin);
  } else if (isSameCalendarDay(targetDate, nowDate)) {
    relative = formatRelativeHoursAr(diffHours);
  } else if (isSameCalendarDay(targetDate, yesterdayDate)) {
    relative = 'أمس';
  } else {
    const diffDays = Math.max(2, Math.floor(diffMs / 86400000));
    relative = diffDays <= 10 ? `منذ ${diffDays} أيام` : `منذ ${diffDays} يوماً`;
  }

  let primary: string;
  if (isSameCalendarDay(targetDate, nowDate)) {
    primary = `اليوم · ${timeStr} (${relative})`;
  } else if (isSameCalendarDay(targetDate, yesterdayDate)) {
    primary = `أمس · ${timeStr}`;
  } else {
    primary = `${dateStr} · ${timeStr}`;
  }

  return {
    primary,
    relative,
    exact,
    hasSyncedBefore: true,
  };
}

function upsertById<T extends { id: string }>(list: T[], item: T, prepend = true): T[] {
  const idx = list.findIndex((entry) => entry.id === item.id);
  if (idx >= 0) {
    const copy = [...list];
    copy[idx] = item;
    return copy;
  }
  return prepend ? [item, ...list] : [...list, item];
}

function upsertManyById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  let result = [...existing];
  for (const item of incoming) {
    result = upsertById(result, item, false);
  }
  return result;
}

/**
 * Layers pending IndexedDB outbox operations over an incoming cloud snapshot
 * in chronological order so offline edits never flicker or get overwritten on reconnect
 * before the outbox flush completes.
 */
export function applyPendingOutboxOverlays(
  baseDb: AppDatabase,
  pendingOps: PendingOverlayOp[]
): AppDatabase {
  if (!pendingOps || pendingOps.length === 0) {
    return baseDb;
  }

  const ordered = [...pendingOps].sort((a, b) => a.ts - b.ts);
  let products = [...(baseDb.products || [])];
  let shortages = [...(baseDb.shortages || [])];
  let invoices = [...(baseDb.invoices || [])];
  let settings: StoreSettings = { ...baseDb.settings };
  let trash = [...(baseDb.trash || [])];

  for (const op of ordered) {
    switch (op.type) {
      case 'wipeStoreData':
        products = [];
        shortages = [];
        invoices = [];
        break;
      case 'batchSeedProducts':
        products = upsertManyById(products, op.payload || []);
        break;
      case 'saveProduct':
        products = upsertById(products, op.payload, true);
        break;
      case 'deleteProduct':
        products = products.filter((p) => p.id !== op.id);
        break;
      case 'batchSeedShortages':
        shortages = op.wipeExisting
          ? [...(op.payload || [])]
          : upsertManyById(shortages, op.payload || []);
        break;
      case 'saveShortage':
        shortages = upsertById(shortages, op.payload, true);
        break;
      case 'deleteShortage':
        shortages = shortages.filter((s) => s.id !== op.id);
        break;
      case 'batchSeedInvoices':
        invoices = upsertManyById(invoices, op.payload || []);
        break;
      case 'saveInvoice':
        invoices = upsertById(invoices, op.payload, true);
        break;
      case 'deleteInvoice':
        invoices = invoices.filter((inv) => inv.id !== op.id);
        break;
      case 'saveSettings':
        settings = { ...settings, ...(op.payload || {}) };
        break;
      case 'saveTrashItem':
        trash = upsertById(trash, op.payload, true);
        break;
      case 'batchSaveTrashItems':
        trash = upsertManyById(op.payload || [], trash);
        break;
      case 'deleteTrashItem':
        trash = trash.filter((t) => t.id !== op.id);
        break;
      case 'batchDeleteTrashItems': {
        const dropSet = new Set(op.ids || []);
        trash = trash.filter((t) => !dropSet.has(t.id));
        break;
      }
    }
  }

  return {
    products,
    shortages,
    invoices,
    settings,
    trash,
  };
}

const COLLABORATIVE_OUTBOX_TYPES = new Set<PendingOverlayOp['type']>([
  'saveProduct',
  'saveShortage',
  'saveInvoice',
]);

/**
 * Operations that ANY SecurityGate-unlocked store device can upload directly to Firestore
 * even without Owner Gmail sign-in (new products, shortages create/update, new invoices).
 */
export function isCollaborativeSyncOp(op: Pick<PendingOverlayOp, 'type'>): boolean {
  return COLLABORATIVE_OUTBOX_TYPES.has(op.type);
}

export function canExecuteOutboxOp(op: Pick<PendingOverlayOp, 'type'>, isCloudAdmin: boolean): boolean {
  return isCloudAdmin || isCollaborativeSyncOp(op);
}

export function isPermissionDeniedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  const code = (err as { code?: string })?.code?.toLowerCase() || '';
  return code.includes('permission-denied') || msg.includes('missing or insufficient permissions');
}

