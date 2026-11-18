import {
  AppDatabase,
  CloudBackupChunk,
  CloudBackupManifest,
  Invoice,
  Product,
  ShortageItem,
  StoreSettings,
  TrashEntityType,
  TrashItem,
} from '../types';

export const TRASH_RETENTION_DAYS = 30;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function sanitizeAsciiId(rawId: string, prefix = 'id'): string {
  const cleaned = String(rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, 96);
  return cleaned || `${prefix}_${Date.now().toString(36)}`;
}

function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

export function createTrashItem(
  entityType: TrashEntityType,
  item: Product | Invoice | ShortageItem,
  nowDate: Date = new Date(),
  deletedBy?: string
): TrashItem {
  const deletedAt = nowDate.toISOString();
  const expiresAt = new Date(nowDate.getTime() + TRASH_RETENTION_MS).toISOString();
  const safeOriginalId = sanitizeAsciiId(item.id, entityType).slice(0, 128);
  const rand = Math.random().toString(36).slice(2, 6);
  const trashId = `tr_${entityType}_${nowDate.getTime().toString(36)}_${rand}_${safeOriginalId}`.slice(0, 128);

  let title = 'عنصر محذوف';
  let subtitle = '';
  let snapshotData: Record<string, any>;

  if (entityType === 'product') {
    const p = item as Product;
    title = String(p.name || 'صنف').trim().slice(0, 300) || 'صنف';
    const parts: string[] = [`قطاعي: ${Number(p.price) || 0} ج.م`];
    const wholesale = p.wholesalePrice ?? p.buyWholesale;
    if (wholesale !== undefined && wholesale !== null && Number.isFinite(Number(wholesale))) {
      parts.push(`جملة: ${Number(wholesale)} ج.م`);
    }
    const dozen = p.dozenPrice ?? p.sellDozenRetail;
    if (dozen !== undefined && dozen !== null && Number.isFinite(Number(dozen))) {
      parts.push(`دستة: ${Number(dozen)} ج.م`);
    }
    parts.push(p.category || 'بدون مجموعة');
    subtitle = parts.join(' · ').slice(0, 300);
    snapshotData = stripUndefined({
      id: p.id,
      name: title,
      price: Number(p.price) || 0,
      category: p.category || 'بدون مجموعة',
      wholesalePrice: wholesale !== undefined && wholesale !== null ? Number(wholesale) : undefined,
      dozenPrice: dozen !== undefined && dozen !== null ? Number(dozen) : undefined,
      image: typeof p.image === 'string' && p.image.length <= 250000 ? p.image : undefined,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
  } else if (entityType === 'invoice') {
    const inv = item as Invoice;
    title = (`فاتورة #${inv.id}${inv.customer ? ` — ${inv.customer}` : ''}`).slice(0, 300);
    subtitle = `الإجمالي: ${Number(inv.total) || 0} ج.م · ${(inv.items || []).length} صنف`.slice(0, 300);
    snapshotData = stripUndefined({
      id: inv.id,
      customer: inv.customer || '',
      items: Array.isArray(inv.items) ? inv.items.map((it) => stripUndefined({ ...it })) : [],
      total: Number(inv.total) || 0,
      discount: inv.discount !== undefined ? Number(inv.discount) : undefined,
      notes: inv.notes || '',
      date: inv.date || deletedAt,
      updatedAt: inv.updatedAt,
    });
  } else {
    const sh = item as ShortageItem;
    title = String(sh.name || 'صنف ناقص').trim().slice(0, 300) || 'صنف ناقص';
    subtitle = `الكمية المطلوبة: ${Number(sh.quantity) || 1} · ${sh.category || 'بدون مجموعة'}`.slice(0, 300);
    snapshotData = stripUndefined({
      id: sh.id,
      name: title,
      quantity: Math.max(1, Math.round(Number(sh.quantity) || 1)),
      category: sh.category || 'بدون مجموعة',
      done: Boolean(sh.done),
      date: sh.date || deletedAt,
      notes: sh.notes,
      updatedAt: sh.updatedAt,
    });
  }

  return stripUndefined({
    id: trashId,
    entityType,
    originalId: safeOriginalId,
    title,
    subtitle,
    data: snapshotData as Product | Invoice | ShortageItem,
    deletedAt,
    expiresAt,
    deletedBy: deletedBy ? String(deletedBy).slice(0, 150) : undefined,
  });
}

export function isTrashItemExpired(item: TrashItem, nowMs: number = Date.now()): boolean {
  const expMs = Date.parse(item.expiresAt);
  if (!Number.isFinite(expMs)) return false;
  return expMs <= nowMs;
}

export function filterActiveTrashItems(items: TrashItem[], nowMs: number = Date.now()): TrashItem[] {
  return (items || [])
    .filter((item) => !isTrashItemExpired(item, nowMs))
    .sort((a, b) => (Date.parse(b.deletedAt) || 0) - (Date.parse(a.deletedAt) || 0));
}

export function getExpiredTrashIds(items: TrashItem[], nowMs: number = Date.now()): string[] {
  return (items || [])
    .filter((item) => isTrashItemExpired(item, nowMs))
    .map((item) => item.id);
}

export function getTrashRemainingDays(item: TrashItem, nowMs: number = Date.now()): number {
  const expMs = Date.parse(item.expiresAt);
  if (!Number.isFinite(expMs)) return TRASH_RETENTION_DAYS;
  const diff = expMs - nowMs;
  if (diff <= 0) return 0;
  return Math.max(1, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

export function restoreItemFromTrash(db: AppDatabase, trashItem: TrashItem): AppDatabase {
  const nextTrash = (db.trash || []).filter((t) => t.id !== trashItem.id);

  if (trashItem.entityType === 'product') {
    const raw = trashItem.data as Product;
    const restoredProduct: Product = {
      ...raw,
      id: raw.id || trashItem.originalId,
      wholesalePrice: raw.wholesalePrice ?? raw.buyWholesale ?? null,
      buyWholesale: raw.wholesalePrice ?? raw.buyWholesale ?? null,
      dozenPrice: raw.dozenPrice ?? raw.sellDozenRetail ?? null,
      sellDozenRetail: raw.dozenPrice ?? raw.sellDozenRetail ?? null,
      updatedAt: new Date().toISOString(),
    };
    const exists = db.products.some((p) => p.id === restoredProduct.id);
    const products = exists
      ? db.products.map((p) => (p.id === restoredProduct.id ? restoredProduct : p))
      : [restoredProduct, ...db.products];
    return { ...db, products, trash: nextTrash };
  }

  if (trashItem.entityType === 'invoice') {
    const raw = trashItem.data as Invoice;
    const restoredInvoice: Invoice = {
      ...raw,
      id: raw.id || trashItem.originalId,
    };
    const exists = db.invoices.some((inv) => inv.id === restoredInvoice.id);
    const invoices = exists
      ? db.invoices.map((inv) => (inv.id === restoredInvoice.id ? restoredInvoice : inv))
      : [restoredInvoice, ...db.invoices];
    return { ...db, invoices, trash: nextTrash };
  }

  const raw = trashItem.data as ShortageItem;
  const restoredShortage: ShortageItem = {
    ...raw,
    id: raw.id || trashItem.originalId,
  };
  const exists = db.shortages.some((s) => s.id === restoredShortage.id);
  const shortages = exists
    ? db.shortages.map((s) => (s.id === restoredShortage.id ? restoredShortage : s))
    : [restoredShortage, ...db.shortages];
  return { ...db, shortages, trash: nextTrash };
}

export function getDailyBackupDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildDailyBackupId(dateKey: string): string {
  return `daily_${String(dateKey || '').replace(/[^0-9]/g, '_')}`;
}

export function isDailyBackupId(backupId: string): boolean {
  return /^daily_\d{4}_\d{2}_\d{2}$/.test(String(backupId || ''));
}

function estimateJsonSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 1024;
  }
}

export function normalizeProductForCloudBackup(p: Product): Product {
  const cleanName = String(p.name || 'صنف').trim().slice(0, 300) || 'صنف';
  const cleanCategory = String(p.category || 'بدون مجموعة').trim().slice(0, 150) || 'بدون مجموعة';
  const wholesale = p.wholesalePrice ?? p.buyWholesale;
  const dozen = p.dozenPrice ?? p.sellDozenRetail;

  return stripUndefined({
    id: String(p.id || '').slice(0, 128),
    name: cleanName,
    price: Number.isFinite(Number(p.price)) ? Math.max(0, Number(p.price)) : 0,
    category: cleanCategory,
    wholesalePrice:
      wholesale !== undefined && wholesale !== null && Number.isFinite(Number(wholesale))
        ? Math.max(0, Number(wholesale))
        : undefined,
    dozenPrice:
      dozen !== undefined && dozen !== null && Number.isFinite(Number(dozen))
        ? Math.max(0, Number(dozen))
        : undefined,
    image: typeof p.image === 'string' && p.image.length <= 250000 ? p.image : undefined,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt.slice(0, 64) : undefined,
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt.slice(0, 64) : undefined,
  }) as Product;
}

export function buildSnapshotChunks(
  backupId: string,
  db: AppDatabase,
  maxChunkBytes: number = 320000
): CloudBackupChunk[] {
  const chunks: CloudBackupChunk[] = [];
  let curProducts: Product[] = [];
  let curInvoices: Invoice[] = [];
  let curShortages: ShortageItem[] = [];
  let curBytes = 128;

  const pushCurrentChunk = () => {
    const idx = chunks.length;
    chunks.push({
      id: `chunk_${idx}`,
      backupId,
      chunkIndex: idx,
      products: curProducts,
      invoices: curInvoices,
      shortages: curShortages,
    });
    curProducts = [];
    curInvoices = [];
    curShortages = [];
    curBytes = 128;
  };

  for (const rawProduct of db.products || []) {
    const clean = normalizeProductForCloudBackup(rawProduct);
    const size = estimateJsonSize(clean);
    if (
      (curProducts.length >= 150 || curBytes + size > maxChunkBytes) &&
      (curProducts.length > 0 || curInvoices.length > 0 || curShortages.length > 0)
    ) {
      pushCurrentChunk();
    }
    curProducts.push(clean);
    curBytes += size;
  }

  for (const rawInv of db.invoices || []) {
    const clean = stripUndefined({
      id: String(rawInv.id || '').slice(0, 128),
      customer: rawInv.customer ? String(rawInv.customer).slice(0, 200) : '',
      items: Array.isArray(rawInv.items) ? rawInv.items.slice(0, 500).map((it) => stripUndefined({ ...it })) : [],
      total: Number.isFinite(Number(rawInv.total)) ? Math.max(0, Number(rawInv.total)) : 0,
      discount:
        rawInv.discount !== undefined && rawInv.discount !== null && Number.isFinite(Number(rawInv.discount))
          ? Math.max(0, Number(rawInv.discount))
          : undefined,
      notes: rawInv.notes ? String(rawInv.notes).slice(0, 500) : undefined,
      date: String(rawInv.date || new Date().toISOString()).slice(0, 64),
      updatedAt: typeof rawInv.updatedAt === 'string' ? rawInv.updatedAt.slice(0, 64) : undefined,
    }) as Invoice;
    const size = estimateJsonSize(clean);
    if (
      (curInvoices.length >= 150 || curBytes + size > maxChunkBytes) &&
      (curProducts.length > 0 || curInvoices.length > 0 || curShortages.length > 0)
    ) {
      pushCurrentChunk();
    }
    curInvoices.push(clean);
    curBytes += size;
  }

  for (const rawSh of db.shortages || []) {
    const clean = stripUndefined({
      id: String(rawSh.id || '').slice(0, 128),
      name: String(rawSh.name || 'صنف ناقص').slice(0, 300),
      quantity: Math.max(1, Math.min(10000, Math.round(Number(rawSh.quantity) || 1))),
      category: String(rawSh.category || 'بدون مجموعة').slice(0, 150),
      done: Boolean(rawSh.done),
      date: String(rawSh.date || new Date().toISOString()).slice(0, 64),
      notes: rawSh.notes ? String(rawSh.notes).slice(0, 500) : undefined,
      updatedAt: typeof rawSh.updatedAt === 'string' ? rawSh.updatedAt.slice(0, 64) : undefined,
    }) as ShortageItem;
    const size = estimateJsonSize(clean);
    if (
      (curShortages.length >= 250 || curBytes + size > maxChunkBytes) &&
      (curProducts.length > 0 || curInvoices.length > 0 || curShortages.length > 0)
    ) {
      pushCurrentChunk();
    }
    curShortages.push(clean);
    curBytes += size;
  }

  if (curProducts.length > 0 || curInvoices.length > 0 || curShortages.length > 0 || chunks.length === 0) {
    pushCurrentChunk();
  }

  return chunks;
}

export function reassembleDatabaseFromBackup(
  manifest: CloudBackupManifest,
  chunks: CloudBackupChunk[],
  fallbackSettings: StoreSettings
): AppDatabase {
  const maxChunkCount = Number.isFinite(manifest.chunkCount) && manifest.chunkCount > 0 ? manifest.chunkCount : Infinity;
  const ordered = [...chunks]
    .filter((ch) => {
      const idx = Number(ch.chunkIndex);
      return Number.isFinite(idx) && idx >= 0 && idx < maxChunkCount;
    })
    .sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0));
  const products: Product[] = [];
  const invoices: Invoice[] = [];
  const shortages: ShortageItem[] = [];

  for (const chunk of ordered) {
    if (Array.isArray(chunk.products)) {
      for (const p of chunk.products) {
        const wholesale = p.wholesalePrice ?? p.buyWholesale ?? null;
        const dozen = p.dozenPrice ?? p.sellDozenRetail ?? null;
        products.push({
          ...p,
          wholesalePrice: wholesale,
          buyWholesale: wholesale,
          dozenPrice: dozen,
          sellDozenRetail: dozen,
        });
      }
    }
    if (Array.isArray(chunk.invoices)) {
      invoices.push(...chunk.invoices);
    }
    if (Array.isArray(chunk.shortages)) {
      shortages.push(...chunk.shortages);
    }
  }

  return {
    products,
    invoices,
    shortages,
    settings: {
      ...fallbackSettings,
      ...(manifest.settings || {}),
    },
  };
}

export interface AutoDailyBackupCheckParams {
  isUnlocked?: boolean;
  isOwner?: boolean;
  isAuthorizedCloud?: boolean;
  isOnline: boolean;
  hasRealData: boolean;
  productCount: number;
  invoiceCount: number;
  shortageCount: number;
  existingDailyBackup?: CloudBackupManifest | null;
  nowMs?: number;
  minRefreshIntervalMs?: number;
}

export function shouldTriggerAutoDailyBackup({
  isUnlocked = true,
  isOnline,
  hasRealData,
  productCount,
  invoiceCount,
  shortageCount,
  existingDailyBackup,
  nowMs = Date.now(),
  minRefreshIntervalMs = 5 * 60 * 1000,
}: AutoDailyBackupCheckParams): boolean {
  if (!isUnlocked || !isOnline || !hasRealData) return false;
  if (productCount <= 0) return false;

  if (!existingDailyBackup) return true;

  const lastUpdated = Date.parse(existingDailyBackup.updatedAt);
  if (Number.isFinite(lastUpdated) && nowMs - lastUpdated < minRefreshIntervalMs) {
    return false;
  }

  const countsChanged =
    existingDailyBackup.productCount !== productCount ||
    existingDailyBackup.invoiceCount !== invoiceCount ||
    existingDailyBackup.shortageCount !== shortageCount;

  // Refresh today's snapshot if counts changed OR more than 6 hours passed today
  const sixHoursMs = 6 * 60 * 60 * 1000;
  return countsChanged || !Number.isFinite(lastUpdated) || nowMs - lastUpdated >= sixHoursMs;
}

export function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function encodeUtf8Base64Url(text: string): string {
  return encodeUtf8Base64(text)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function wrapBase64Lines(b64: string, lineLength = 76): string {
  if (!b64) return '';
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += lineLength) {
    lines.push(b64.slice(i, i + lineLength));
  }
  return lines.join('\r\n');
}

export function buildDailyBackupEmailSubject(shopName: string, dateKey: string): string {
  const cleanShop = String(shopName || 'مكتبة الطيب أحسن').trim() || 'مكتبة الطيب أحسن';
  return `نسخة احتياطية يومية — ${cleanShop} (${dateKey})`;
}

export interface DailyBackupEmailResult {
  raw: string;
  mimeText: string;
  subject: string;
  filename: string;
  summaryText: string;
  productCount: number;
  categoryCount: number;
  invoiceCount: number;
  shortageCount: number;
}

export function buildDailyBackupMimeEmail(params: {
  to: string;
  shopName?: string;
  dateKey: string;
  snapshotDb: AppDatabase;
  generatedAtIso?: string;
}): DailyBackupEmailResult {
  const cleanTo = String(params.to || '').trim();
  const cleanShop = String(params.shopName || params.snapshotDb.settings?.shop || 'مكتبة الطيب أحسن').trim() || 'مكتبة الطيب أحسن';
  const dateKey = String(params.dateKey || getDailyBackupDateKey()).trim();
  const generatedAt = params.generatedAtIso || new Date().toISOString();

  const products = (params.snapshotDb.products || []).map(normalizeProductForCloudBackup);
  const invoices = params.snapshotDb.invoices || [];
  const shortages = params.snapshotDb.shortages || [];
  const trash = params.snapshotDb.trash || [];
  const categoryCount = new Set(
    products.map((p) => (p.category || 'بدون مجموعة').trim() || 'بدون مجموعة')
  ).size;

  const subject = buildDailyBackupEmailSubject(cleanShop, dateKey);
  const encodedSubject = `=?UTF-8?B?${encodeUtf8Base64(subject)}?=`;
  const filename = `tayeb-cloud-backup-${dateKey}.json`;

  const exportPayload = {
    products,
    invoices,
    shortages,
    trash,
    settings: params.snapshotDb.settings || { shop: cleanShop, phone: '' },
    backupDateKey: dateKey,
    exportedAt: generatedAt,
    source: 'owner_daily_cloud_gmail_backup',
  };

  const summaryLines = [
    `النسخة الاحتياطية السحابية اليومية — ${cleanShop}`,
    `التاريخ: ${dateKey}`,
    `وقت الإنشاء: ${generatedAt}`,
    ``,
    `ملخص بيانات المتجر المرفقة:`,
    `- إجمالي الأصناف: ${products.length} صنف`,
    `- عدد المجموعات: ${categoryCount} مجموعة`,
    `- إجمالي الفواتير: ${invoices.length} فاتورة`,
    `- قائمة النواقص: ${shortages.length} صنف`,
    `- سلة المهملات (30 يوم): ${trash.length} عنصر`,
    ``,
    `طريقة الاسترجاع عند الحاجة:`,
    `افتح التطبيق -> الإعدادات -> استعادة من ملف، واختر ملف JSON المرفق في هذه الرسالة لاستعادة كل الأصناف والأسعار والمجموعات فوراً.`,
  ];
  const summaryText = summaryLines.join('\n');

  const jsonContent = JSON.stringify(exportPayload, null, 2);
  const boundary = `----=_TayebBackup_${dateKey.replace(/[^0-9]/g, '')}_${Math.random().toString(36).slice(2, 8)}`;

  const bodyB64 = wrapBase64Lines(encodeUtf8Base64(summaryText));
  const attachmentB64 = wrapBase64Lines(encodeUtf8Base64(jsonContent));

  const mimeParts = [
    `To: ${cleanTo}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    bodyB64,
    ``,
    `--${boundary}`,
    `Content-Type: application/json; charset="UTF-8"; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    attachmentB64,
    ``,
    `--${boundary}--`,
  ];

  const mimeText = mimeParts.join('\r\n');
  const raw = encodeUtf8Base64Url(mimeText);

  return {
    raw,
    mimeText,
    subject,
    filename,
    summaryText,
    productCount: products.length,
    categoryCount,
    invoiceCount: invoices.length,
    shortageCount: shortages.length,
  };
}

export interface DailyGmailBackupCheckParams {
  isOwner: boolean;
  isCloudAdmin: boolean;
  isOnline: boolean;
  hasRealData: boolean;
  productCount: number;
  ownerEmail: string;
  signedInEmail?: string | null;
  todayKey: string;
  lastSentDateKey?: string | null;
}

export function shouldPromptDailyGmailBackup({
  isOwner,
  isCloudAdmin,
  isOnline,
  hasRealData,
  productCount,
  ownerEmail,
  signedInEmail,
  todayKey,
  lastSentDateKey,
}: DailyGmailBackupCheckParams): boolean {
  if (!isOwner || !isCloudAdmin || !isOnline || !hasRealData) return false;
  if (productCount <= 0) return false;
  const cleanSigned = String(signedInEmail || '').trim().toLowerCase();
  const cleanOwner = String(ownerEmail || '').trim().toLowerCase();
  if (!cleanSigned || !cleanOwner || cleanSigned !== cleanOwner) return false;
  return String(lastSentDateKey || '') !== String(todayKey || '');
}

