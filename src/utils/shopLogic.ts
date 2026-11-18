import { CartItem, Invoice, Product, ShortageItem } from '../types';

/**
 * Normalizes Arabic text for uniform searching and duplicate comparison.
 * Normalizes variations of Alef (أ, إ, آ, ٱ -> ا), Taa Marbuta (ة -> ه), Yaa (ى -> ي),
 * removes diacritics, tatweel, and invisible directional/zero-width marks,
 * converts Arabic-Indic/Persian digits (٠-٩, ۰-۹ -> 0-9), and normalizes whitespaces.
 */
export function normalizeArabicText(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0640\u064B-\u065F\u0670]/g, '') // Tatweel + Arabic diacritics / Tashkeel
    .replace(/\s+/g, ' ');
}

/**
 * Normalizes Arabic & mixed alphanumeric text specifically for forgiving search matching:
 * - Normalizes hamza-on-waw/yaa (ؤ -> و, ئ -> ي)
 * - Turns punctuation/separators (e.g. '-', '/', '(', ')') into spaces while keeping decimals (e.g. 0.7)
 * - Separates glued digit<->Arabic and Arabic<->ASCII boundaries (e.g. "٨٠ورقه" -> "80 ورقه", "٤لون" -> "4 لون", "ورقa4" -> "ورق a4")
 */
export function normalizeArabicSearchText(str: string): string {
  if (!str) return '';
  return normalizeArabicText(str)
    .replace(/ئ/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/(\d)\.(\d)/g, '$1__DECIMAL_DOT__$2')
    .replace(/[-_/\\()[\]{}.,،;:+*&|"'`~?!؟]+/g, ' ')
    .replace(/__DECIMAL_DOT__/g, '.')
    .replace(/(\d)([\u0621-\u064A])/g, '$1 $2')
    .replace(/([\u0621-\u064A])(\d)/g, '$1 $2')
    .replace(/([\u0621-\u064A])([a-z0-9])/g, '$1 $2')
    .replace(/([a-z0-9])([\u0621-\u064A])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits a search query into normalized word tokens for order-independent and boundary-safe matching.
 */
export function tokenizeArabicSearch(query: string): string[] {
  const norm = normalizeArabicSearchText(query);
  if (!norm) return [];
  return norm.split(' ').filter(Boolean);
}

/**
 * Checks whether all pre-normalized search tokens appear in the combined normalized fields,
 * regardless of word order, intervening words, glued spaces, or leading definite article "ال".
 */
export function matchesNormalizedTokens(
  tokens: string[],
  ...normalizedFields: Array<string | undefined | null>
): boolean {
  if (tokens.length === 0) return true;
  const haystack = normalizedFields.filter(Boolean).join(' ');
  if (!haystack) return false;

  // Ultra-fast path for standard queries where every token is directly found
  if (tokens.every((token) => haystack.includes(token))) {
    return true;
  }

  // Fallback path: normalize boundary/punctuation + spaceless comparison + leading "ال" article
  const searchHaystack = normalizeArabicSearchText(haystack);
  if (tokens.every((token) => searchHaystack.includes(token))) {
    return true;
  }

  const haystackNoSpaces = searchHaystack.replace(/\s+/g, '');
  return tokens.every((token) => {
    if (searchHaystack.includes(token)) return true;
    if (haystackNoSpaces.includes(token)) return true;
    if (token.startsWith('ال') && token.length >= 5) {
      const stem = token.slice(2);
      if (searchHaystack.startsWith(stem) || searchHaystack.includes(` ${stem}`)) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Order-independent, space-forgiving multi-word Arabic search across one or more raw text fields.
 */
export function matchesArabicSearchQuery(
  query: string,
  ...fields: Array<string | undefined | null>
): boolean {
  const tokens = tokenizeArabicSearch(query);
  if (tokens.length === 0) return true;
  const normalizedFields = fields.map((f) => (f ? normalizeArabicSearchText(f) : ''));
  return matchesNormalizedTokens(tokens, ...normalizedFields);
}

/**
 * Safely formats date and time in Arabic locale without throwing errors.
 */
export function formatDateTime(dateVal: string | number | Date): string {
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    try {
      return new Date(dateVal).toLocaleDateString('ar-EG');
    } catch {
      return String(dateVal || '');
    }
  }
}

/**
 * Formats a number in Egyptian Pounds currency format.
 */
export function formatCurrency(amount: number | null | undefined): string {
  const num = Number(amount || 0);
  return `${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ج.م`;
}

/**
 * Calculates the total sum for a list of cart items.
 */
export function calculateCartTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => {
    const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
    const price = Math.max(0, Number(item.price) || 0);
    return sum + price * qty;
  }, 0);
}

function roundCurrencyValue(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.max(0, Math.round(val * 100) / 100);
}

/**
 * Sets a custom unit price for a specific cart item on the current invoice only,
 * preserving its original catalog price so the user can restore it anytime.
 */
export function updateCartItemPrice(
  items: CartItem[],
  itemId: string,
  nextPrice: number
): CartItem[] {
  if (!Number.isFinite(nextPrice)) return items;
  const safePrice = roundCurrencyValue(nextPrice);
  return items.map((item) => {
    if (item.id !== itemId) return item;
    const baseOriginal =
      item.originalPrice !== undefined && item.originalPrice !== null
        ? item.originalPrice
        : item.price;
    return {
      ...item,
      originalPrice: baseOriginal,
      price: safePrice,
    };
  });
}

/**
 * Increments or decrements a cart item's unit price for the current invoice only.
 */
export function adjustCartItemPrice(
  items: CartItem[],
  itemId: string,
  delta: number
): CartItem[] {
  if (!Number.isFinite(delta)) return items;
  return items.map((item) => {
    if (item.id !== itemId) return item;
    const baseOriginal =
      item.originalPrice !== undefined && item.originalPrice !== null
        ? item.originalPrice
        : item.price;
    const safePrice = roundCurrencyValue((Number(item.price) || 0) + delta);
    return {
      ...item,
      originalPrice: baseOriginal,
      price: safePrice,
    };
  });
}

/**
 * Restores a cart item's unit price back to its original catalog price.
 */
export function resetCartItemPrice(items: CartItem[], itemId: string): CartItem[] {
  return items.map((item) => {
    if (item.id !== itemId) return item;
    if (item.originalPrice === undefined || item.originalPrice === null) return item;
    return {
      ...item,
      price: roundCurrencyValue(item.originalPrice),
    };
  });
}

/**
 * Checks whether a product with the same normalized name already exists
 * (excluding the current product being edited if currentId is provided).
 */
export function isDuplicateProduct(
  name: string,
  currentId: string | null,
  products: Product[]
): boolean {
  const normalized = normalizeArabicText(name);
  if (!normalized) return false;
  return products.some(
    p => p.id !== currentId && normalizeArabicText(p.name) === normalized
  );
}

/**
 * Groups an array of products by category name.
 */
export function groupProductsByCategory(products: Product[]): Record<string, Product[]> {
  const groups: Record<string, Product[]> = {};
  for (const p of products) {
    const cat = (p.category || 'بدون مجموعة').trim() || 'بدون مجموعة';
    if (!groups[cat]) {
      groups[cat] = [];
    }
    groups[cat].push(p);
  }
  return groups;
}

/**
 * Splits an array into balanced column slices for multi-column print tables.
 */
export function splitIntoColumns<T>(items: T[], cols: number): T[][] {
  if (!items || !items.length) return [];
  const safeCols = Math.max(1, cols);
  const perCol = Math.ceil(items.length / safeCols);
  const result: T[][] = [];
  for (let i = 0; i < safeCols; i++) {
    const chunk = items.slice(i * perCol, (i + 1) * perCol);
    if (chunk.length > 0) {
      result.push(chunk);
    }
  }
  return result;
}

/**
 * Calculates total sales for a given calendar date (defaults to today).
 */
export function calculateDailySales(invoices: Invoice[], targetDate: Date = new Date()): number {
  const targetDateString = targetDate.toISOString().split('T')[0];
  return invoices.reduce((sum, inv) => {
    try {
      const invDateString = new Date(inv.date).toISOString().split('T')[0];
      if (invDateString === targetDateString) {
        return sum + (Number(inv.total) || 0);
      }
    } catch {
      // Ignore invalid dates
    }
    return sum;
  }, 0);
}

/**
 * Groups an array of cart items or items with category by category name.
 */
export function groupItemsByCategory<T extends { category?: string }>(items: T[]): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of items) {
    const cat = (item.category || 'بدون مجموعة').trim() || 'بدون مجموعة';
    if (!groups[cat]) {
      groups[cat] = [];
    }
    groups[cat].push(item);
  }
  return groups;
}

/**
 * Generates formatted WhatsApp plain-text bill for sending to customers,
 * with items neatly grouped by category (e.g. educational books together, stationery together).
 */
export function generateInvoiceWhatsAppText(
  invoice: Invoice,
  shopName: string,
  phone: string
): string {
  const lines: string[] = [
    `📚 *${shopName}*`,
    `📱 واتساب: ${phone}`,
    `🧾 *فاتورة مبيعات ${invoice.id ? `رقم #${invoice.id}` : ''}*`,
    `📅 التاريخ: ${formatDateTime(invoice.date)}`
  ];

  if (invoice.customer) {
    lines.push(`👤 العميل: *${invoice.customer}*`);
  }

  lines.push('─────────────────');

  // Group items by category so each group is together
  const grouped = groupItemsByCategory(invoice.items);
  const categories = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'ar'));

  let globalIndex = 1;
  categories.forEach((cat) => {
    const itemsInCat = grouped[cat];
    lines.push(`\n📁 *[ ${cat} ]*`);
    itemsInCat.forEach((item) => {
      const qty = Math.max(1, Number(item.quantity) || 1);
      const lineTotal = item.price * qty;
      const unitStr = item.unit === 'dozen' ? ' [دستة]' : '';
      lines.push(`${globalIndex}. ${item.name}${unitStr} (${qty} × ${formatCurrency(item.price)}) = *${formatCurrency(lineTotal)}*`);
      globalIndex++;
    });
  });

  lines.push('\n─────────────────');
  lines.push(`💰 *المبلغ الإجمالي: ${formatCurrency(invoice.total)}*`);
  lines.push('✨ شرفتنا بزيارتك ونسعد بخدمتك دائماً! ❤️');

  return lines.join('\n');
}

/**
 * Generates formatted WhatsApp plain-text list of shortages for ordering from wholesalers,
 * grouped cleanly by category so educational books, stationery, etc. are each together.
 */
export function generateShortagesWhatsAppText(
  shortages: ShortageItem[],
  shopName: string
): string {
  const active = shortages;
  const lines: string[] = [
    `📋 *طلبية نواقص - ${shopName}*`,
    `📅 التاريخ: ${new Date().toLocaleDateString('ar-EG')}`,
    `📦 إجمالي الأصناف المطلوبة: ${active.length} صنف`,
    '─────────────────'
  ];

  if (active.length === 0) {
    lines.push('لا توجد أصناف ناقصة حالياً.');
  } else {
    // Group active shortages by category
    const grouped = groupItemsByCategory(active);
    const categories = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'ar'));

    let globalIndex = 1;
    categories.forEach((cat) => {
      const itemsInCat = grouped[cat];
      lines.push(`\n📁 *[ ${cat} ]* (${itemsInCat.length} صنف):`);
      itemsInCat.forEach((item) => {
        const notePart = item.notes?.trim() ? ` (${item.notes.trim()})` : '';
        lines.push(`${globalIndex}. ${item.name}${notePart} — مطلوب: *${item.quantity}*`);
        globalIndex++;
      });
    });
  }

  lines.push('\n─────────────────');
  lines.push('يرجى تأكيد توفر الأصناف والكميات والأسعار.');

  return lines.join('\n');
}

/**
 * Safely parses and bounds shortage quantity to prevent NaN, zero, or negative numbers.
 */
export function sanitizeShortageQuantity(val: unknown, fallback: number = 1): number {
  const num = parseInt(String(val), 10);
  if (isNaN(num) || num < 1) {
    return Math.max(1, fallback);
  }
  return Math.min(10000, num);
}

export type ShortagesPrintColumnPref = 'auto' | 2 | 3 | 4;

export interface ShortagesPrintLayout {
  columns: 1 | 2 | 3 | 4;
  gridColsClass: string;
  gapClass: string;
  fontSizeClass: string;
  qtySizeClass: string;
  noteSizeClass: string;
  cellPadClass: string;
  headPadClass: string;
  qtyColWidthClass: string;
  isCompactChrome: boolean;
}

/**
 * Calculates optimal column count (1-4) and largest readable font sizes
 * so all shortage items fit onto a single A4 portrait sheet without serial/checkbox clutter.
 */
export function getShortagesPrintLayout(
  itemCount: number,
  columnPref: ShortagesPrintColumnPref = 'auto'
): ShortagesPrintLayout {
  const count = Math.max(0, itemCount);

  let columns: 1 | 2 | 3 | 4;
  if (columnPref === 2 || columnPref === 3 || columnPref === 4) {
    columns = columnPref;
  } else if (count <= 14) {
    columns = 1;
  } else if (count <= 54) {
    columns = 2;
  } else if (count <= 96) {
    columns = 3;
  } else {
    columns = 4;
  }

  const rowsPerCol = Math.ceil(Math.max(1, count) / columns);

  const gridColsClass =
    columns === 1
      ? 'grid-cols-1'
      : columns === 2
      ? 'grid-cols-2'
      : columns === 3
      ? 'grid-cols-3'
      : 'grid-cols-4';

  const gapClass =
    columns === 1
      ? 'gap-0'
      : columns === 2
      ? 'gap-3'
      : columns === 3
      ? 'gap-2'
      : 'gap-1.5';

  // Maximize font readability based on rows per column AND column width budget
  let fontSizeClass: string;
  let qtySizeClass: string;
  let noteSizeClass: string;
  let cellPadClass: string;
  let headPadClass: string;
  let qtyColWidthClass: string;

  if (columns === 1) {
    fontSizeClass = 'text-[14pt] leading-snug';
    qtySizeClass = 'text-[14.5pt]';
    noteSizeClass = 'text-[13pt]';
    cellPadClass = 'py-2.5 px-3';
    headPadClass = 'py-2 px-3 text-[12pt]';
    qtyColWidthClass = 'w-20';
  } else if (columns === 2) {
    if (rowsPerCol <= 16) {
      fontSizeClass = 'text-[12.5pt] leading-snug';
      qtySizeClass = 'text-[13pt]';
      noteSizeClass = 'text-[11.5pt]';
      cellPadClass = 'py-2 px-2.5';
      headPadClass = 'py-1.5 px-2.5 text-[11pt]';
    } else if (rowsPerCol <= 24) {
      fontSizeClass = 'text-[11.5pt] leading-tight';
      qtySizeClass = 'text-[12pt]';
      noteSizeClass = 'text-[10.5pt]';
      cellPadClass = 'py-1.5 px-2';
      headPadClass = 'py-1.5 px-2 text-[10.5pt]';
    } else {
      fontSizeClass = 'text-[10.5pt] leading-tight';
      qtySizeClass = 'text-[11pt]';
      noteSizeClass = 'text-[9.5pt]';
      cellPadClass = 'py-1 px-1.5';
      headPadClass = 'py-1 px-1.5 text-[10pt]';
    }
    qtyColWidthClass = 'w-14';
  } else if (columns === 3) {
    if (rowsPerCol <= 24) {
      fontSizeClass = 'text-[10.5pt] leading-tight';
      qtySizeClass = 'text-[11pt]';
      noteSizeClass = 'text-[9.5pt]';
      cellPadClass = 'py-1 px-1.5';
      headPadClass = 'py-1 px-1.5 text-[9.5pt]';
    } else if (rowsPerCol <= 32) {
      fontSizeClass = 'text-[9.5pt] leading-tight';
      qtySizeClass = 'text-[10pt]';
      noteSizeClass = 'text-[8.5pt]';
      cellPadClass = 'py-[3px] px-1.5';
      headPadClass = 'py-1 px-1.5 text-[9pt]';
    } else {
      fontSizeClass = 'text-[8.5pt] leading-tight';
      qtySizeClass = 'text-[9pt]';
      noteSizeClass = 'text-[8pt]';
      cellPadClass = 'py-[2px] px-1';
      headPadClass = 'py-[3px] px-1 text-[8.5pt]';
    }
    qtyColWidthClass = 'w-11';
  } else {
    // 4 columns for high-volume lists squeezed onto 1 A4 page
    if (rowsPerCol <= 28) {
      fontSizeClass = 'text-[9.2pt] leading-tight';
      qtySizeClass = 'text-[9.5pt]';
      noteSizeClass = 'text-[8.5pt]';
      cellPadClass = 'py-[3px] px-1';
      headPadClass = 'py-1 px-1 text-[8.5pt]';
    } else if (rowsPerCol <= 38) {
      fontSizeClass = 'text-[8.2pt] leading-tight';
      qtySizeClass = 'text-[8.5pt]';
      noteSizeClass = 'text-[7.5pt]';
      cellPadClass = 'py-[2px] px-1';
      headPadClass = 'py-[3px] px-1 text-[8pt]';
    } else {
      fontSizeClass = 'text-[7.4pt] leading-none';
      qtySizeClass = 'text-[7.8pt]';
      noteSizeClass = 'text-[7pt]';
      cellPadClass = 'py-[1.5px] px-1';
      headPadClass = 'py-[2px] px-1 text-[7.5pt]';
    }
    qtyColWidthClass = 'w-9';
  }

  return {
    columns,
    gridColsClass,
    gapClass,
    fontSizeClass,
    qtySizeClass,
    noteSizeClass,
    cellPadClass,
    headPadClass,
    qtyColWidthClass,
    isCompactChrome: count > 18
  };
}

export type ProductSortField = 'name' | 'createdAt' | 'price';
export type SortDirection = 'asc' | 'desc';

export const PRODUCT_SORT_STORAGE_KEY = 'tayeb_product_sort_v1';

export function getDefaultSortDirection(field: ProductSortField): SortDirection {
  return field === 'createdAt' ? 'desc' : 'asc';
}

const MIN_REALISTIC_PRODUCT_TS = 1577836800000; // 2020-01-01T00:00:00Z
const MAX_REALISTIC_PRODUCT_TS = 2208988800000; // 2040-01-01T00:00:00Z

/**
 * Extracts the creation timestamp in ms for a product.
 * Supports explicit `createdAt` ISO strings as well as legacy products whose IDs
 * begin with `Date.now().toString(36)` (8-char base36 timestamps).
 */
export function getProductAddedTimestamp(product: Product, fallbackOrder: number = 0): number {
  if (product.createdAt) {
    const parsed = Date.parse(product.createdAt);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }

  if (product.id && /^[0-9a-z]{8}/i.test(product.id)) {
    const base36Ts = parseInt(product.id.slice(0, 8), 36);
    if (
      Number.isFinite(base36Ts) &&
      base36Ts >= MIN_REALISTIC_PRODUCT_TS &&
      base36Ts <= MAX_REALISTIC_PRODUCT_TS
    ) {
      return base36Ts;
    }
  }

  if (product.updatedAt) {
    const parsedUpdated = Date.parse(product.updatedAt);
    if (!Number.isNaN(parsedUpdated) && parsedUpdated > 0) {
      return parsedUpdated;
    }
  }

  return fallbackOrder;
}

/**
 * Returns a short formatted Arabic date when a real addition timestamp is known.
 */
export function formatProductAddedDate(product: Product): string {
  const ts = getProductAddedTimestamp(product, -1);
  if (ts < MIN_REALISTIC_PRODUCT_TS) return '';
  try {
    return new Date(ts).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

/**
 * Sorts a product list by Arabic alphabetical name, date added, or price.
 */
export function sortProducts<T extends Product>(
  products: T[],
  field: ProductSortField,
  direction: SortDirection
): T[] {
  const dir = direction === 'asc' ? 1 : -1;
  return products
    .map((product, index) => ({
      product,
      index,
      addedTs: getProductAddedTimestamp(product, -1 - index),
    }))
    .sort((a, b) => {
      if (field === 'price') {
        const priceDiff = (Number(a.product.price) || 0) - (Number(b.product.price) || 0);
        if (priceDiff !== 0) return priceDiff * dir;
        return a.product.name.localeCompare(b.product.name, 'ar');
      }

      if (field === 'createdAt') {
        const tsDiff = a.addedTs - b.addedTs;
        if (tsDiff !== 0) return tsDiff * dir;
        return a.product.name.localeCompare(b.product.name, 'ar');
      }

      const nameDiff = a.product.name.localeCompare(b.product.name, 'ar');
      if (nameDiff !== 0) return nameDiff * dir;
      return a.product.id.localeCompare(b.product.id);
    })
    .map((entry) => entry.product);
}

export interface QuickAddInvoiceInput {
  name: string;
  piecePriceStr: string;
  dozenPriceStr?: string;
  category?: string;
  quantity: number;
  unit: 'piece' | 'dozen';
  saveToCatalog: boolean;
  existingProducts: Product[];
  now?: Date;
}

export type QuickAddInvoiceResult =
  | {
      ok: true;
      cartItem: CartItem;
      productToRegister: Product | null;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Builds a cart line item from the POS manual item modal.
 * By default (`saveToCatalog === false`), the item is added ONLY to the active invoice cart
 * with custom manual pricing (`productToRegister: null`) and is NOT saved to `db.products` or cloud.
 * Only when the user explicitly confirms `saveToCatalog: true` is a catalog Product generated.
 */
export function buildQuickAddInvoiceResult(input: QuickAddInvoiceInput): QuickAddInvoiceResult {
  const cleanName = String(input.name || '').trim();
  if (!cleanName) {
    return { ok: false, error: 'يرجى إدخال اسم الصنف' };
  }

  const rawPiece = String(input.piecePriceStr ?? '').trim();
  const rawDozen = String(input.dozenPriceStr ?? '').trim();

  const parsedPiece = rawPiece !== '' ? parseFloat(rawPiece) : NaN;
  const parsedDozen = rawDozen !== '' ? parseFloat(rawDozen) : NaN;

  let piecePrice = parsedPiece;
  if (input.unit === 'dozen' && rawPiece === '' && Number.isFinite(parsedDozen) && parsedDozen >= 0) {
    piecePrice = roundCurrencyValue(parsedDozen / 12);
  }

  if (!Number.isFinite(piecePrice) || piecePrice < 0) {
    return { ok: false, error: 'يرجى إدخال سعر بيع يدوي صحيح' };
  }

  if (rawDozen !== '' && (!Number.isFinite(parsedDozen) || parsedDozen < 0)) {
    return { ok: false, error: 'يرجى إدخال سعر الدستة بشكل صحيح' };
  }

  const effectiveDozenPrice =
    Number.isFinite(parsedDozen) && parsedDozen > 0
      ? roundCurrencyValue(parsedDozen)
      : roundCurrencyValue(piecePrice * 12);

  const safeUnit: 'piece' | 'dozen' = input.unit === 'dozen' ? 'dozen' : 'piece';
  const unitPrice = safeUnit === 'dozen' ? effectiveDozenPrice : roundCurrencyValue(piecePrice);
  const safeQty = Math.max(1, Math.min(1000, Math.round(Number(input.quantity) || 1)));
  const cleanCategory = String(input.category || '').trim() || (input.saveToCatalog ? 'بدون مجموعة' : 'أصناف يدوية');

  const nowDate = input.now || new Date();
  const nowIso = nowDate.toISOString();
  const randSuffix = Math.random().toString(36).slice(2, 6);

  if (input.saveToCatalog) {
    if (isDuplicateProduct(cleanName, null, input.existingProducts || [])) {
      return {
        ok: false,
        error:
          'هذا الصنف مسجل بالفعل في قائمة الأصناف — يمكنك إلغاء تحديد «تسجيل الصنف في قائمة الأصناف» لإضافته يدوياً لهذه الفاتورة فقط.',
      };
    }

    const newId = nowDate.getTime().toString(36) + randSuffix;
    const newProduct: Product = {
      id: newId,
      name: cleanName,
      category: cleanCategory,
      price: roundCurrencyValue(piecePrice),
      buyWholesale: null,
      sellDozenRetail: Number.isFinite(parsedDozen) && parsedDozen >= 0 ? roundCurrencyValue(parsedDozen) : null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const cartItemId = safeUnit === 'dozen' ? `${newId}-dozen` : newId;
    return {
      ok: true,
      productToRegister: newProduct,
      cartItem: {
        id: cartItemId,
        productId: newId,
        name: cleanName,
        price: unitPrice,
        originalPrice: unitPrice,
        quantity: safeQty,
        category: cleanCategory,
        unit: safeUnit,
      },
    };
  }

  // Manual temporary item for this invoice only (NEVER added to db.products or cloud catalog)
  const manualId = `manual_${nowDate.getTime().toString(36)}_${randSuffix}${safeUnit === 'dozen' ? '-dozen' : ''}`;
  return {
    ok: true,
    productToRegister: null,
    cartItem: {
      id: manualId,
      name: cleanName,
      price: unitPrice,
      originalPrice: unitPrice,
      quantity: safeQty,
      category: cleanCategory,
      unit: safeUnit,
    },
  };
}

/**
 * Normalizes an Egyptian mobile/phone string into valid international `wa.me` digits (e.g. `01151906520` -> `201151906520`).
 */
export function formatWhatsAppEgyptNumber(phone: string): string {
  const ascii = String(phone || '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^0-9]/g, '');

  if (!ascii) return '';
  if (ascii.startsWith('0020')) {
    return ascii.slice(2);
  }
  if (ascii.startsWith('20') && ascii.length >= 11) {
    return ascii;
  }
  if (ascii.startsWith('0')) {
    return `20${ascii.replace(/^0+/, '')}`;
  }
  if (ascii.startsWith('1') && ascii.length === 10) {
    return `20${ascii}`;
  }
  return ascii;
}

/**
 * Builds a complete `https://wa.me/...` URL with optional prefilled message text.
 */
export function buildWhatsAppUrl(phone: string, text?: string): string {
  const formatted = formatWhatsAppEgyptNumber(phone);
  const base = formatted ? `https://wa.me/${formatted}` : 'https://wa.me/';
  if (!text) return base;
  return `${base}?text=${encodeURIComponent(text)}`;
}




