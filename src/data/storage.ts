import { AppDatabase, Invoice, Product, ShortageItem, StoreSettings } from '../types';
import seedDataRaw from './seedData.json';

const STORAGE_KEY = 'tayeb_library_v3';
const SLICE_KEYS = {
  products: 'tayeb_library_v3_products',
  invoices: 'tayeb_library_v3_invoices',
  shortages: 'tayeb_library_v3_shortages',
  settings: 'tayeb_library_v3_settings',
  trash: 'tayeb_library_v3_trash',
} as const;
const LEGACY_STORAGE_KEY = 'tayeb_library_simple_v2';
const CLOUD_CONFIG_KEY = 'tayeb_library_cloud_config_v1';
const EXPLICIT_EMPTY_KEY = 'tayeb_explicit_empty_v1';

export function markExplicitEmptyCatalog(isEmpty: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (isEmpty) {
      localStorage.setItem(EXPLICIT_EMPTY_KEY, 'true');
    } else {
      localStorage.removeItem(EXPLICIT_EMPTY_KEY);
    }
  } catch {
    // Ignore
  }
}

export function isExplicitEmptyCatalog(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(EXPLICIT_EMPTY_KEY) === 'true';
  } catch {
    return false;
  }
}

export const emptyDatabase: AppDatabase = {
  products: [],
  invoices: [],
  shortages: [],
  trash: [],
  settings: {
    shop: '',
    phone: '',
    address: '',
    tagline: ''
  }
};

/**
 * Optional sample dataset for new/empty stores.
 */
export const sampleSeedData: AppDatabase = {
  products: (seedDataRaw as unknown as AppDatabase).products || [],
  invoices: (seedDataRaw as unknown as AppDatabase).invoices || [],
  shortages: (seedDataRaw as unknown as AppDatabase).shortages || [],
  trash: [],
  settings: {
    shop: 'مكتبة الطيب أحسن',
    phone: '01151906520',
    address: '',
    tagline: 'لجميع الأدوات المدرسية والمكتبية والخدمات الطلابية'
  }
};

export const defaultData: AppDatabase = sampleSeedData;

const IDB_NAME = 'tayeb_offline_slices_v1';
const IDB_STORE = 'slices';

function openSliceIdb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSetSlice(slice: keyof typeof SLICE_KEYS, value: unknown): Promise<void> {
  try {
    const db = await openSliceIdb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, slice);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore IDB errors silently
  }
}

async function idbGetSlice<T>(slice: keyof typeof SLICE_KEYS): Promise<T | null> {
  try {
    const db = await openSliceIdb();
    if (!db) return null;
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(slice);
      req.onsuccess = () => {
        resolve((req.result as T) ?? null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function loadProductsFromIndexedCache(): Promise<Product[] | null> {
  const val = await idbGetSlice<Product[]>('products');
  return Array.isArray(val) && val.length > 0 ? val : null;
}

export async function loadAllSlicesFromIndexedCache(): Promise<Partial<AppDatabase> | null> {
  try {
    const [products, invoices, shortages, settings, trash] = await Promise.all([
      idbGetSlice<Product[]>('products'),
      idbGetSlice<Invoice[]>('invoices'),
      idbGetSlice<ShortageItem[]>('shortages'),
      idbGetSlice<StoreSettings>('settings'),
      idbGetSlice<AppDatabase['trash']>('trash'),
    ]);
    const result: Partial<AppDatabase> = {};
    if (Array.isArray(products) && (products.length > 0 || isExplicitEmptyCatalog())) {
      result.products = products;
    }
    if (Array.isArray(invoices)) result.invoices = invoices;
    if (Array.isArray(shortages)) result.shortages = shortages;
    if (Array.isArray(trash)) result.trash = trash;
    if (settings && typeof settings === 'object' && settings.shop) result.settings = settings;
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

function cleanupLegacyStorageKeys(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    // Reclaim any huge legacy localStorage outbox (now safely stored in IndexedDB)
    localStorage.removeItem('tayeb_offline_outbox_v1');
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('store_user_db_')) {
        toRemove.push(k);
      }
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Ignore
  }
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; code?: number; message?: string };
  return (
    e.name === 'QuotaExceededError' ||
    e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 ||
    e.code === 1014 ||
    Boolean(e.message && e.message.toLowerCase().includes('quota'))
  );
}

function writeSliceSafely<K extends keyof AppDatabase>(slice: K, val: AppDatabase[K]): void {
  if (slice === 'products' && Array.isArray(val) && val.length > 0) {
    markExplicitEmptyCatalog(false);
  }
  // Always mirror ALL slices cleanly to IndexedDB asynchronously (no 5MB limit!)
  void idbSetSlice(slice, val);

  const key = SLICE_KEYS[slice];
  const serialized = JSON.stringify(val);

  try {
    localStorage.setItem(key, serialized);
    return;
  } catch (err) {
    if (!isQuotaError(err)) {
      console.warn(`Could not save slice ${slice} to localStorage:`, err);
      return;
    }
  }

  // Quota exceeded: reclaim ONLY legacy/bloated keys first WITHOUT deleting current slice key!
  cleanupLegacyStorageKeys();
  try {
    localStorage.setItem(key, serialized);
    return;
  } catch (retryErr) {
    if (slice === 'products' && Array.isArray(val)) {
      // Strip heavy base64 images in localStorage metadata cache (full images stay safe in IndexedDB + Firestore)
      try {
        const compactProducts = (val as Product[]).map((p) => {
          if (p.image && p.image.length > 300) {
            const { image: _img, ...rest } = p;
            return rest;
          }
          return p;
        });
        localStorage.setItem(key, JSON.stringify(compactProducts));
        return;
      } catch (compactErr) {
        // Keep existing localStorage slice untouched if compact write still fails; IndexedDB holds the full data
        console.warn('Products localStorage compact cache skipped (using IndexedDB instead):', compactErr);
        return;
      }
    }
    console.warn(`LocalStorage quota tight for slice ${slice}:`, retryErr);
  }
}

/**
 * Loads data from fast split localStorage slices (or migrates from legacy single key)
 * and reports whether the app had to fall back to bundled seedData.
 */
export function getStoredDataWithMeta(): { db: AppDatabase; isSeedFallback: boolean } {
  if (typeof window === 'undefined') {
    return { db: sampleSeedData, isSeedFallback: true };
  }

  try {
    const explicitEmpty = isExplicitEmptyCatalog();
    const rawInvoices = localStorage.getItem(SLICE_KEYS.invoices);
    const rawShortages = localStorage.getItem(SLICE_KEYS.shortages);
    const rawSettings = localStorage.getItem(SLICE_KEYS.settings);
    const rawTrash = localStorage.getItem(SLICE_KEYS.trash);
    const parsedSettings = rawSettings ? JSON.parse(rawSettings) : {};
    const parsedTrash = rawTrash ? JSON.parse(rawTrash) : [];

    // 1. Prefer fast per-slice keys when available (or explicit wiped store)
    const rawProducts = localStorage.getItem(SLICE_KEYS.products);
    if (rawProducts) {
      const products = JSON.parse(rawProducts);
      if (Array.isArray(products) && (products.length > 0 || explicitEmpty)) {
        if (
          localStorage.getItem(STORAGE_KEY) ||
          localStorage.getItem(LEGACY_STORAGE_KEY) ||
          localStorage.getItem('tayeb_offline_outbox_v1')
        ) {
          cleanupLegacyStorageKeys();
        }
        return {
          isSeedFallback: false,
          db: {
            products,
            invoices: rawInvoices ? JSON.parse(rawInvoices) : [],
            shortages: rawShortages ? JSON.parse(rawShortages) : [],
            trash: Array.isArray(parsedTrash) ? parsedTrash : [],
            settings: {
              shop: parsedSettings?.shop || 'مكتبة الطيب أحسن',
              phone: parsedSettings?.phone || '01151906520',
              address: parsedSettings?.address || '',
              tagline: parsedSettings?.tagline || 'لجميع الأدوات المدرسية والمكتبية والخدمات الطلابية'
            }
          }
        };
      }
    }

    if (explicitEmpty) {
      return {
        isSeedFallback: false,
        db: {
          products: [],
          invoices: rawInvoices ? JSON.parse(rawInvoices) : [],
          shortages: rawShortages ? JSON.parse(rawShortages) : [],
          trash: Array.isArray(parsedTrash) ? parsedTrash : [],
          settings: {
            shop: parsedSettings?.shop || 'مكتبة الطيب أحسن',
            phone: parsedSettings?.phone || '01151906520',
            address: parsedSettings?.address || '',
            tagline: parsedSettings?.tagline || 'لجميع الأدوات المدرسية والمكتبية والخدمات الطلابية'
          }
        }
      };
    }

    // 2. Migrate from legacy unified storage key
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const products = Array.isArray(parsed.products) ? parsed.products : [];
        if (products.length > 0) {
          const result: AppDatabase = {
            products,
            invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
            shortages: Array.isArray(parsed.shortages) ? parsed.shortages : [],
            settings: {
              shop: parsed.settings?.shop || 'مكتبة الطيب أحسن',
              phone: parsed.settings?.phone || '01151906520',
              address: parsed.settings?.address || '',
              tagline: parsed.settings?.tagline || 'لجميع الأدوات المدرسية والمكتبية والخدمات الطلابية'
            }
          };
          cleanupLegacyStorageKeys();
          saveStoredData(result);
          return { db: result, isSeedFallback: false };
        }
      }
    }

    // 3. Check legacy account keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('store_user_db_')) {
        const item = localStorage.getItem(key);
        if (item) {
          try {
            const parsed = JSON.parse(item);
            if (parsed && Array.isArray(parsed.products) && parsed.products.length > 0) {
              const result: AppDatabase = {
                products: parsed.products,
                invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
                shortages: Array.isArray(parsed.shortages) ? parsed.shortages : [],
                settings: {
                  shop: parsed.settings?.shop || 'مكتبة الطيب أحسن',
                  phone: parsed.settings?.phone || '01151906520',
                  address: parsed.settings?.address || '',
                  tagline: parsed.settings?.tagline || 'لجميع الأدوات المدرسية والمكتبية والخدمات الطلابية'
                }
              };
              cleanupLegacyStorageKeys();
              saveStoredData(result);
              return { db: result, isSeedFallback: false };
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    console.error('Error reading localStorage data:', err);
  }

  // 4. Fallback to bundled sample catalog (until IndexedDB or Cloud Auth restores user's catalog)
  return { db: sampleSeedData, isSeedFallback: true };
}

export function getStoredData(): AppDatabase {
  return getStoredDataWithMeta().db;
}

/**
 * Requests the browser to mark storage as persistent so it never gets evicted.
 */
export async function enablePersistentStorage(): Promise<boolean> {
  if (typeof window !== 'undefined' && navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persisted();
      if (!isPersisted) {
        return await navigator.storage.persist();
      }
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

const pendingSliceTimers: Partial<Record<keyof typeof SLICE_KEYS, ReturnType<typeof setTimeout>>> = {};
const pendingSliceValues: Partial<Record<keyof typeof SLICE_KEYS, unknown>> = {};

/**
 * Persists a single slice of the database with a small debounce so rapid UI interactions stay instantaneous.
 */
export function saveStoredSlice<K extends keyof AppDatabase>(slice: K, value: AppDatabase[K], immediate = false): void {
  if (typeof window === 'undefined') return;
  pendingSliceValues[slice] = value;

  if (pendingSliceTimers[slice]) {
    clearTimeout(pendingSliceTimers[slice]);
  }

  const writeNow = () => {
    const val = pendingSliceValues[slice] as AppDatabase[K] | undefined;
    if (val !== undefined) {
      writeSliceSafely(slice, val);
      delete pendingSliceValues[slice];
    }
    delete pendingSliceTimers[slice];
  };

  if (immediate) {
    writeNow();
  } else {
    pendingSliceTimers[slice] = setTimeout(writeNow, 150);
  }
}

export function flushPendingStoredSlices(): void {
  if (typeof window === 'undefined') return;
  (Object.keys(pendingSliceValues) as Array<keyof typeof SLICE_KEYS>).forEach((slice) => {
    if (pendingSliceTimers[slice]) {
      clearTimeout(pendingSliceTimers[slice]);
      delete pendingSliceTimers[slice];
    }
    const val = pendingSliceValues[slice] as AppDatabase[typeof slice] | undefined;
    if (val !== undefined) {
      writeSliceSafely(slice, val);
      delete pendingSliceValues[slice];
    }
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPendingStoredSlices);
}

/**
 * Persists all database slices cleanly.
 */
export function saveStoredData(data: AppDatabase): void {
  if (typeof window === 'undefined') return;
  saveStoredSlice('products', data.products, true);
  saveStoredSlice('invoices', data.invoices, true);
  saveStoredSlice('shortages', data.shortages, true);
  saveStoredSlice('settings', data.settings, true);
  if (Array.isArray(data.trash)) {
    saveStoredSlice('trash', data.trash, true);
  }
}

/**
 * Compresses an image file client-side to JPEG with high fidelity and small footprint.
 */
export function compressImage(file: File, maxDimension: number = 640): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      return reject(new Error('يرجى اختيار ملف صورة صالح'));
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('فشل قراءة ملف الصورة'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('تعذر تحميل الصورة'));
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));

          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('تعذر إنشاء سياق الرسم'));

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          resolve(dataUrl);
        } catch (e) {
          reject(e);
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Strips confidential wholesale buy prices when exporting data in non-owner mode.
 */
export function sanitizeDatabaseForExport(data: AppDatabase, includeWholesale: boolean): AppDatabase {
  if (includeWholesale) return data;
  return {
    ...data,
    products: data.products.map((p) => {
      const { buyWholesale: _bw, wholesalePrice: _wp, ...rest } = p;
      return rest;
    }),
  };
}

/**
 * Downloads the current database as a JSON backup file.
 */
export function exportDataAsJsonFile(data: AppDatabase, includeWholesale = false): void {
  const safeData = sanitizeDatabaseForExport(data, includeWholesale);
  const blob = new Blob([JSON.stringify(safeData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().split('T')[0];
  a.href = url;
  a.download = `نسخة-احتياطية-مكتبة-الطيب-أحسن-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Validates and parses an imported JSON file content.
 */
export function parseImportedJson(jsonStr: string): AppDatabase {
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed.products)) {
    throw new Error('الملف غير صالح: قائمة الأصناف غير موجودة');
  }
  return {
    products: parsed.products as Product[],
    invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
    shortages: Array.isArray(parsed.shortages) ? parsed.shortages : [],
    trash: Array.isArray(parsed.trash) ? parsed.trash : [],
    settings: {
      ...defaultData.settings,
      ...(parsed.settings || {})
    }
  };
}

/**
 * Cloud sync settings helpers
 */
export interface CloudConfig {
  url: string;
  key: string;
}

export function getCloudConfig(): CloudConfig {
  if (typeof window === 'undefined') {
    return {
      url: 'https://script.google.com/macros/s/AKfycbxI0YcFRuc-airMiFR0mPdvCg2sxUkwkBeuhkATuV19FgVZvlsorls6fO89mFAQSggy/exec',
      key: ''
    };
  }
  try {
    const raw = localStorage.getItem(CLOUD_CONFIG_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // fallback
  }
  return {
    url: 'https://script.google.com/macros/s/AKfycbxI0YcFRuc-airMiFR0mPdvCg2sxUkwkBeuhkATuV19FgVZvlsorls6fO89mFAQSggy/exec',
    key: ''
  };
}

export function saveCloudConfig(config: CloudConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(config));
  } catch (err) {
    console.error('Error saving cloud config:', err);
  }
}
