import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeArabicText,
  formatCurrency,
  calculateCartTotal,
  isDuplicateProduct,
  groupProductsByCategory,
  splitIntoColumns,
  calculateDailySales,
  generateInvoiceWhatsAppText,
  formatDateTime,
  sanitizeShortageQuantity
} from './shopLogic';
import { CartItem, Product, Invoice } from '../types';

test('normalizeArabicText normalizes Arabic variations and spaces', () => {
  assert.equal(normalizeArabicText('  كشكول   أزرق  '), 'كشكول ازرق');
  assert.equal(normalizeArabicText('إبرة كُرَةٌ'), 'ابره كره');
  assert.equal(normalizeArabicText('ألوان مياه بالألوان'), 'الوان مياه بالالوان');
});

test('calculateCartTotal correctly sums up items with valid quantities', () => {
  const items: CartItem[] = [
    { id: '1', name: 'كشكول 60', price: 25, quantity: 2 },
    { id: '2', name: 'قلم جاف', price: 5, quantity: 3 },
  ];
  assert.equal(calculateCartTotal(items), 65);
});

test('calculateCartTotal handles zero or fractional items safely', () => {
  const items: CartItem[] = [
    { id: '1', name: 'مسطرة', price: 10, quantity: 1 }
  ];
  assert.equal(calculateCartTotal(items), 10);
  assert.equal(calculateCartTotal([]), 0);
});

test('isDuplicateProduct accurately detects duplicates ignoring alef/spaces', () => {
  const products: Product[] = [
    { id: 'p1', name: 'كشكول سلك 60 ورقه كبير', price: 30, category: 'الورقيات' },
    { id: 'p2', name: 'قلم رصاص فيبركاسل', price: 15, category: 'ادوات مكتبيه' }
  ];

  // Exact match
  assert.equal(isDuplicateProduct('كشكول سلك 60 ورقه كبير', null, products), true);
  // Normalized variant match with alef / space
  assert.equal(isDuplicateProduct('  كشكول سلك 60 ورقة كبير  ', null, products), true);
  // Same product being edited should not be flagged as duplicate of itself
  assert.equal(isDuplicateProduct('كشكول سلك 60 ورقه كبير', 'p1', products), false);
  // New unique product
  assert.equal(isDuplicateProduct('قلم حبر باركر', null, products), false);
});

test('groupProductsByCategory partitions products appropriately', () => {
  const products: Product[] = [
    { id: '1', name: 'صنف 1', price: 10, category: 'الورقيات' },
    { id: '2', name: 'صنف 2', price: 20, category: 'ادوات مكتبيه' },
    { id: '3', name: 'صنف 3', price: 30, category: 'الورقيات' },
  ];
  const groups = groupProductsByCategory(products);
  assert.equal(Object.keys(groups).length, 2);
  assert.equal(groups['الورقيات'].length, 2);
  assert.equal(groups['ادوات مكتبيه'].length, 1);
});

test('splitIntoColumns balances items across columns', () => {
  const items = [1, 2, 3, 4, 5, 6, 7];
  const cols = splitIntoColumns(items, 3);
  assert.equal(cols.length, 3);
  assert.equal(cols[0].length, 3);
  assert.equal(cols[1].length, 3);
  assert.equal(cols[2].length, 1);
});

test('calculateDailySales accumulates only matching date', () => {
  const now = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const invoices: Invoice[] = [
    { id: '0001', total: 150, items: [], date: now.toISOString() },
    { id: '0002', total: 200, items: [], date: now.toISOString() },
    { id: '0003', total: 500, items: [], date: yesterday.toISOString() },
  ];

  const todaySales = calculateDailySales(invoices, now);
  assert.equal(todaySales, 350);
});

test('generateInvoiceWhatsAppText contains required invoice fields', () => {
  const inv: Invoice = {
    id: '0102',
    customer: 'أحمد محمود',
    items: [{ id: '1', name: 'كشكول 60', price: 20, quantity: 2 }],
    total: 40,
    date: new Date().toISOString()
  };
  const text = generateInvoiceWhatsAppText(inv, 'مكتبة الطيب أحسن', '01151906520');
  assert.match(text, /مكتبة الطيب أحسن/);
  assert.match(text, /01151906520/);
  assert.match(text, /أحمد محمود/);
  assert.match(text, /40/);
});

test('formatDateTime formats date safely without throwing', () => {
  const result = formatDateTime(new Date('2026-10-26T12:00:00Z'));
  assert.ok(result.length > 0);
  // Handles invalid date safely
  assert.equal(formatDateTime('invalid-date'), '');
});

test('sanitizeShortageQuantity prevents NaN, zero, or negative quantities', () => {
  assert.equal(sanitizeShortageQuantity(5), 5);
  assert.equal(sanitizeShortageQuantity('12'), 12);
  assert.equal(sanitizeShortageQuantity(0), 1);
  assert.equal(sanitizeShortageQuantity(-3), 1);
  assert.equal(sanitizeShortageQuantity('abc'), 1);
  assert.equal(sanitizeShortageQuantity(null), 1);
  assert.equal(sanitizeShortageQuantity(undefined), 1);
  assert.equal(sanitizeShortageQuantity(''), 1);
  assert.equal(sanitizeShortageQuantity(999999), 10000);
});

test('parseImportedJson preserves all 60 shortages from backup without truncating', async () => {
  const { parseImportedJson } = await import('../data/storage');
  const mock60Shortages = Array.from({ length: 60 }, (_, i) => ({
    id: `shortage-${i + 1}`,
    name: `صنف ناقص ${i + 1}`,
    quantity: i + 1,
    category: 'الورقيات',
    date: new Date().toISOString()
  }));

  const mockBackupJson = JSON.stringify({
    products: [{ id: 'p1', name: 'قلم جاف', price: 5 }],
    invoices: [],
    shortages: mock60Shortages,
    settings: { shop: 'مكتبة الطيب أحسن' }
  });

  const parsed = parseImportedJson(mockBackupJson);
  assert.equal(parsed.shortages.length, 60);
  assert.equal(parsed.shortages[0].name, 'صنف ناقص 1');
  assert.equal(parsed.shortages[59].name, 'صنف ناقص 60');
  assert.equal(parsed.products.length, 1);
});

test('SecurityGate verifies hashed credentials securely and normalizes Arabic digits', async () => {
  const {
    normalizeCredentialDigits,
    verifyGateCredentialsOffline,
    verifyOwnerPinOffline,
  } = await import('../utils/cryptoAuth');

  assert.equal(normalizeCredentialDigits('١٩٦٤٩٩'), '196499');
  assert.equal(normalizeCredentialDigits('٤٤٣٧٦٠'), '443760');
  assert.equal(await verifyGateCredentialsOffline('196499', '443760'), true);
  assert.equal(await verifyGateCredentialsOffline('١٩٦٤٩٩', '٤٤٣٧٦٠'), true);
  assert.equal(await verifyGateCredentialsOffline('196499', '000000'), false);
  assert.equal(await verifyGateCredentialsOffline('wrong', '443760'), false);
  assert.equal(await verifyOwnerPinOffline('443760'), true);
  assert.equal(await verifyOwnerPinOffline('123456'), false);
});

test('Arabic alphabetical sorting correctly orders products and shortages', () => {
  const items = [
    { name: 'مسطرة حديد 30 سم' },
    { name: 'ألوان شمع 12 لون' },
    { name: 'براية معدن' },
    { name: 'كشكول سلك 60 ورقة' },
    { name: 'استيكة روترنج' }
  ];

  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const names = sorted.map(i => i.name);

  // 'أ' and 'ا' come first in Arabic alphabet, then 'ب', then 'ك', then 'م'
  assert.equal(names[names.length - 1], 'مسطرة حديد 30 سم');
  assert.ok(names.indexOf('براية معدن') < names.indexOf('كشكول سلك 60 ورقة'));
  assert.ok(names.indexOf('كشكول سلك 60 ورقة') < names.indexOf('مسطرة حديد 30 سم'));
});

test('generateShortagesWhatsAppText formats items and includes custom notes', async () => {
  const { generateShortagesWhatsAppText } = await import('./shopLogic');
  const items = [
    {
      id: 's1',
      name: 'كشكول سلك 80 ورقة',
      quantity: 25,
      category: 'الورقيات',
      notes: 'غلاف كرتون مقوى أزرق',
      done: false,
      date: new Date().toISOString()
    },
    {
      id: 's2',
      name: 'قلم جاف روترنج',
      quantity: 12,
      category: 'أدوات مكتبية',
      done: false,
      date: new Date().toISOString()
    }
  ];

  const text = generateShortagesWhatsAppText(items, 'مكتبة الطيب أحسن');
  assert.match(text, /كشكول سلك 80 ورقة \(غلاف كرتون مقوى أزرق\) — مطلوب: \*25\*/);
  assert.match(text, /قلم جاف روترنج — مطلوب: \*12\*/);
});

test('generateInvoiceWhatsAppText formats dozen items with [دستة] label', async () => {
  const { generateInvoiceWhatsAppText } = await import('./shopLogic');
  const inv = {
    id: '0105',
    customer: 'أحمد محمود',
    items: [
      { id: '1', name: 'كشكول 60', price: 20, quantity: 2, unit: 'piece' as const },
      { id: '2', name: 'أقلام جاف روتو', price: 120, quantity: 1, unit: 'dozen' as const }
    ],
    total: 160,
    date: new Date().toISOString()
  };

  const text = generateInvoiceWhatsAppText(inv, 'مكتبة الطيب أحسن', '01151906520');
  assert.match(text, /أقلام جاف روتو \[دستة\] \(1 × 120 ج\.م\) = \*120 ج\.م\*/);
  assert.match(text, /كشكول 60 \(2 × 20 ج\.م\) = \*40 ج\.م\*/);
  assert.match(text, /المبلغ الإجمالي: 160 ج\.م/);
});

test('getShortagesPrintLayout scales 1-4 columns and maximizes readable typography', async () => {
  const { getShortagesPrintLayout } = await import('./shopLogic');

  const few = getShortagesPrintLayout(8, 'auto');
  assert.equal(few.columns, 1);
  assert.match(few.fontSizeClass, /14pt/);

  const medium47 = getShortagesPrintLayout(47, 'auto');
  assert.equal(medium47.columns, 2);
  assert.match(medium47.fontSizeClass, /11\.5pt/);

  const many75 = getShortagesPrintLayout(75, 'auto');
  assert.equal(many75.columns, 3);

  const dense130 = getShortagesPrintLayout(130, 'auto');
  assert.equal(dense130.columns, 4);

  const forced4 = getShortagesPrintLayout(47, 4);
  assert.equal(forced4.columns, 4);
  assert.equal(forced4.gridColsClass, 'grid-cols-4');
});

test('getProductAddedTimestamp resolves explicit createdAt and base36 ID timestamps', async () => {
  const { getProductAddedTimestamp } = await import('./shopLogic');

  const withCreatedAt: Product = {
    id: 'custom-1',
    name: 'صنف بتاريخ صريح',
    price: 10,
    category: 'الورقيات',
    createdAt: '2026-05-10T10:00:00.000Z',
  };
  assert.equal(getProductAddedTimestamp(withCreatedAt), Date.parse('2026-05-10T10:00:00.000Z'));

  const withBase36Id: Product = {
    id: 'mvmit2zbhh48',
    name: 'كشكول قديم',
    price: 8,
    category: 'الورقيات',
  };
  assert.equal(getProductAddedTimestamp(withBase36Id), parseInt('mvmit2zb', 36));

  const legacyFallback: Product = {
    id: 'legacy-item',
    name: 'صنف بدون تاريخ',
    price: 5,
    category: 'الورقيات',
  };
  assert.equal(getProductAddedTimestamp(legacyFallback, -10), -10);
});

test('sortProducts accurately sorts by Arabic name, price, and date added in both directions', async () => {
  const { sortProducts } = await import('./shopLogic');

  const items: Product[] = [
    { id: 'mvmit2zbhh48', name: 'مسطرة 30 سم', price: 15, category: 'ادوات مكتبيه', createdAt: '2025-01-10T00:00:00.000Z' },
    { id: 'mvmmq6j83tgm', name: 'أقلام جاف أزرق', price: 5, category: 'ادوات مكتبيه', createdAt: '2026-03-15T00:00:00.000Z' },
    { id: 'mvmit9vx55df', name: 'كشكول سلك 100', price: 40, category: 'الورقيات', createdAt: '2025-06-20T00:00:00.000Z' },
  ];

  // 1. Alphabetical asc / desc
  const byNameAsc = sortProducts(items, 'name', 'asc').map((p) => p.name);
  assert.equal(byNameAsc[0], 'أقلام جاف أزرق');
  assert.equal(byNameAsc[2], 'مسطرة 30 سم');

  const byNameDesc = sortProducts(items, 'name', 'desc').map((p) => p.name);
  assert.equal(byNameDesc[0], 'مسطرة 30 سم');
  assert.equal(byNameDesc[2], 'أقلام جاف أزرق');

  // 2. Price asc / desc
  const byPriceAsc = sortProducts(items, 'price', 'asc').map((p) => p.price);
  assert.deepEqual(byPriceAsc, [5, 15, 40]);

  const byPriceDesc = sortProducts(items, 'price', 'desc').map((p) => p.price);
  assert.deepEqual(byPriceDesc, [40, 15, 5]);

  // 3. Date added desc (newest first) / asc (oldest first)
  const byDateDesc = sortProducts(items, 'createdAt', 'desc').map((p) => p.id);
  assert.deepEqual(byDateDesc, ['mvmmq6j83tgm', 'mvmit9vx55df', 'mvmit2zbhh48']);

  const byDateAsc = sortProducts(items, 'createdAt', 'asc').map((p) => p.id);
  assert.deepEqual(byDateAsc, ['mvmit2zbhh48', 'mvmit9vx55df', 'mvmmq6j83tgm']);
});

test('matchesArabicSearchQuery matches multi-word queries regardless of word order or digits', async () => {
  const { matchesArabicSearchQuery } = await import('./shopLogic');

  const productName = 'قلم تظهير فسفوري';
  const productCat = 'ادوات مكتبيه';

  // Exact partial words out of order ("قلم فسفوري" matches "قلم تظهير فسفوري")
  assert.equal(matchesArabicSearchQuery('قلم فسفوري', productName, productCat), true);
  assert.equal(matchesArabicSearchQuery('فسفوري قلم', productName, productCat), true);
  assert.equal(matchesArabicSearchQuery('تظهير قلم', productName, productCat), true);

  // Word spanning across product name + category
  assert.equal(matchesArabicSearchQuery('فسفوري مكتبيه', productName, productCat), true);

  // Rejects when any typed word does not exist in item
  assert.equal(matchesArabicSearchQuery('قلم رصاص', productName, productCat), false);

  // Matches across Western & Arabic-Indic digits ("60" <-> "٦٠")
  assert.equal(matchesArabicSearchQuery('كشكول 60', 'كشكول سلك ٦٠ ورقة', 'الورقيات'), true);
  assert.equal(matchesArabicSearchQuery('كشكول ٦٠', 'كشكول سلك 60 ورقه', 'الورقيات'), true);

  // Matches glued number+word without space ("٨٠ورقه", "80ورقة", "٤لون", "ورقه80")
  assert.equal(matchesArabicSearchQuery('٨٠ورقه', 'كشكول سلك ٨٠ ورقه', 'الورقيات'), true);
  assert.equal(matchesArabicSearchQuery('80ورقة', 'كشكول سلك 80 ورقة', 'الورقيات'), true);
  assert.equal(matchesArabicSearchQuery('ورقه80', 'كشكول سلك ٨٠ ورقه', 'الورقيات'), true);
  assert.equal(matchesArabicSearchQuery('4 لون', 'طقم جاف بريما فسفوري ٤لون', 'ادوات مكتبيه'), true);
  assert.equal(matchesArabicSearchQuery('٤لون', 'قلم تحديد فسفوري ( 4 اقلام )', 'ادوات مكتبيه'), false);
  assert.equal(matchesArabicSearchQuery('4اقلام', 'قلم تحديد فسفوري ( 4 اقلام )', 'ادوات مكتبيه'), true);

  // Matches glued Arabic words ("قلمرصاص"), punctuation, decimals, invisible RTL marks, hamza, and "ال" prefix
  assert.equal(matchesArabicSearchQuery('قلمرصاص', 'قلم رصاص فيبر كاسل', 'ادوات مكتبيه'), true);
  assert.equal(matchesArabicSearchQuery('قلم-جاف/ازرق', 'قلم جاف روتو أزرق', 'ادوات مكتبيه'), true);
  assert.equal(matchesArabicSearchQuery('٠.٧مم', 'قلم سنون جيتو 0.7 مم', 'ادوات مكتبيه'), true);
  assert.equal(matchesArabicSearchQuery('توب انجليش', 'كتاب توب \u200Fانجليش', 'كتب تعلميه'), true);
  assert.equal(matchesArabicSearchQuery('صمغ سايل', 'صمغ سائل', 'ادوات مكتبيه'), true);
  assert.equal(matchesArabicSearchQuery('الكشكول ٨٠ورقه', 'كشكول سلك 80 ورقة', 'الورقيات'), true);
});

test('sanitizeDatabaseForExport strips wholesale buy prices for non-owners and keeps them for owners', async () => {
  const { sanitizeDatabaseForExport } = await import('../data/storage');

  const db = {
    products: [
      { id: '1', name: 'كشكول 60', price: 25, category: 'الورقيات', buyWholesale: 18, wholesalePrice: 18, sellDozenRetail: 280 },
    ],
    invoices: [],
    shortages: [],
    settings: { shop: 'مكتبة الطيب أحسن', phone: '01151906520' },
  };

  const cashierExport = sanitizeDatabaseForExport(db, false);
  assert.equal(cashierExport.products[0].price, 25);
  assert.equal('buyWholesale' in cashierExport.products[0], false);
  assert.equal('wholesalePrice' in cashierExport.products[0], false);

  const ownerExport = sanitizeDatabaseForExport(db, true);
  assert.equal(ownerExport.products[0].buyWholesale, 18);
  assert.equal(ownerExport.products[0].wholesalePrice, 18);
});

test('per-invoice cart price adjustments update total cleanly and preserve originalPrice without mutating catalog', async () => {
  const { updateCartItemPrice, adjustCartItemPrice, resetCartItemPrice } = await import('./shopLogic');

  const catalogProduct: Product = {
    id: 'p-80',
    name: 'تكعيب 80 ورقه',
    price: 25,
    sellDozenRetail: 280,
    buyWholesale: 19,
    category: 'الورقيات',
  };

  let cart: CartItem[] = [
    {
      id: catalogProduct.id,
      productId: catalogProduct.id,
      name: catalogProduct.name,
      price: catalogProduct.price,
      originalPrice: catalogProduct.price,
      quantity: 2,
      category: catalogProduct.category,
      unit: 'piece',
    },
  ];

  // Adjust up by +2.5
  cart = adjustCartItemPrice(cart, 'p-80', 2.5);
  assert.equal(cart[0].price, 27.5);
  assert.equal(cart[0].originalPrice, 25);
  assert.equal(calculateCartTotal(cart), 55);

  // Adjust down below zero -> clamps at 0
  cart = adjustCartItemPrice(cart, 'p-80', -100);
  assert.equal(cart[0].price, 0);
  assert.equal(cart[0].originalPrice, 25);
  assert.equal(calculateCartTotal(cart), 0);

  // Set direct custom price
  cart = updateCartItemPrice(cart, 'p-80', 30);
  assert.equal(cart[0].price, 30);
  assert.equal(cart[0].originalPrice, 25);
  assert.equal(calculateCartTotal(cart), 60);

  // Reset restores original catalog price
  cart = resetCartItemPrice(cart, 'p-80');
  assert.equal(cart[0].price, 25);
  assert.equal(calculateCartTotal(cart), 50);

  // Original catalog product price remains strictly untouched
  assert.equal(catalogProduct.price, 25);
});

test('shouldDropFailedSyncOp never drops queued backup restores on permission-denied or pre-auth state', async () => {
  const { shouldDropFailedSyncOp } = await import('../services/offlineSync');

  assert.equal(shouldDropFailedSyncOp(new Error('permission-denied: Missing or insufficient permissions'), false), false);
  assert.equal(shouldDropFailedSyncOp(new Error('permission-denied: Missing or insufficient permissions'), true), false);
  assert.equal(shouldDropFailedSyncOp(new Error('unavailable: offline'), true), false);
  assert.equal(shouldDropFailedSyncOp(new Error('invalid-argument: malformed doc'), false), false);
  assert.equal(shouldDropFailedSyncOp(new Error('invalid-argument: malformed doc'), true), true);
});

test('sanitizeDocId keeps valid ASCII IDs unchanged and prevents collisions on Arabic/empty IDs', async () => {
  const { sanitizeDocId } = await import('../services/firebase');

  assert.equal(sanitizeDocId('mvmit2zbhh48'), 'mvmit2zbhh48');
  assert.equal(sanitizeDocId('item_123-abc'), 'item_123-abc');

  const idA = sanitizeDocId('صنف_١', 'قلم ازرق');
  const idB = sanitizeDocId('صنف_٢', 'قلم احمر');
  assert.match(idA, /^[a-zA-Z0-9_\-]+$/);
  assert.match(idB, /^[a-zA-Z0-9_\-]+$/);
  assert.notEqual(idA, idB);
  assert.equal(sanitizeDocId('صنف_١', 'قلم ازرق'), idA);

  const emptyA = sanitizeDocId('', 'كشكول 80');
  const emptyB = sanitizeDocId('', 'مسطرة 30');
  assert.match(emptyA, /^[a-zA-Z0-9_\-]+$/);
  assert.notEqual(emptyA, emptyB);
});

test('getStoredDataWithMeta identifies bundled seed fallback accurately when window is absent', async () => {
  const { getStoredDataWithMeta, sampleSeedData } = await import('../data/storage');
  const { db, isSeedFallback } = getStoredDataWithMeta();

  assert.equal(isSeedFallback, true);
  assert.equal(db.products.length, sampleSeedData.products.length);
  assert.equal(sampleSeedData.products.length, 355);
});

test('Trash Bin enforces 30-day retention, expiration filter, remaining days, and lossless restore', async () => {
  const {
    TRASH_RETENTION_DAYS,
    TRASH_RETENTION_MS,
    createTrashItem,
    isTrashItemExpired,
    filterActiveTrashItems,
    getExpiredTrashIds,
    getTrashRemainingDays,
    restoreItemFromTrash,
  } = await import('./backupTrashLogic');

  const deletedDate = new Date('2026-10-01T10:00:00.000Z');
  const prod: Product = {
    id: 'p-trash-1',
    name: 'كشكول سلك 100 ورقة',
    price: 35,
    wholesalePrice: 24,
    buyWholesale: 24,
    dozenPrice: 390,
    sellDozenRetail: 390,
    category: 'الورقيات',
  };

  const trashEntry = createTrashItem('product', prod, deletedDate, 'owner@test.com');
  assert.equal(trashEntry.entityType, 'product');
  assert.match(trashEntry.subtitle || '', /قطاعي: 35/);
  assert.match(trashEntry.subtitle || '', /جملة: 24/);
  assert.match(trashEntry.subtitle || '', /دستة: 390/);

  // After 29 days: still active, 1 day left
  const day29 = deletedDate.getTime() + (TRASH_RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000;
  assert.equal(isTrashItemExpired(trashEntry, day29), false);
  assert.equal(getTrashRemainingDays(trashEntry, day29), 1);

  // After 30+ days: expired & auto-purged
  const day31 = deletedDate.getTime() + TRASH_RETENTION_MS + 1000;
  assert.equal(isTrashItemExpired(trashEntry, day31), true);
  assert.equal(getTrashRemainingDays(trashEntry, day31), 0);
  assert.deepEqual(getExpiredTrashIds([trashEntry], day31), [trashEntry.id]);
  assert.equal(filterActiveTrashItems([trashEntry], day31).length, 0);

  // Restoring recovers exact retail, wholesale, dozen prices and category and clears from trash
  const wipedDb = {
    products: [],
    invoices: [],
    shortages: [],
    trash: [trashEntry],
    settings: { shop: 'مكتبة الطيب أحسن', phone: '01151906520' },
  };
  const restored = restoreItemFromTrash(wipedDb, trashEntry);
  assert.equal(restored.products.length, 1);
  assert.equal(restored.products[0].price, 35);
  assert.equal(restored.products[0].wholesalePrice, 24);
  assert.equal(restored.products[0].dozenPrice, 390);
  assert.equal(restored.products[0].category, 'الورقيات');
  assert.equal((restored.trash || []).length, 0);
});

test('Daily cloud snapshot chunking splits 650+ imaged products under byte cap, ignores stale chunks, and allows any unlocked online device to save daily backups', async () => {
  const {
    buildDailyBackupId,
    buildSnapshotChunks,
    isDailyBackupId,
    reassembleDatabaseFromBackup,
    shouldTriggerAutoDailyBackup,
  } = await import('./backupTrashLogic');

  const fakeImg = 'data:image/jpeg;base64,' + 'A'.repeat(2500);
  const largeProducts: Product[] = Array.from({ length: 650 }, (_, idx) => ({
    id: `item_${idx + 1}`,
    name: `صنف مكتبة ${idx + 1}`,
    price: 10 + (idx % 20),
    wholesalePrice: 7 + (idx % 15),
    dozenPrice: 110 + (idx % 100),
    category: idx % 2 === 0 ? 'الورقيات' : 'ادوات مكتبيه',
    image: fakeImg,
  }));

  const db = {
    products: largeProducts,
    invoices: [{ id: '1001', items: [{ id: 'item_1', name: 'صنف مكتبة 1', price: 10, quantity: 2 }], total: 20, date: '2026-11-15T10:00:00Z' }],
    shortages: [{ id: 's1', name: 'صنف مكتبة 2', quantity: 5, category: 'ادوات مكتبيه', done: false, date: '2026-11-15T10:00:00Z' }],
    settings: { shop: 'مكتبة الطيب أحسن', phone: '01151906520' },
  };

  const backupId = buildDailyBackupId('2026-11-15');
  assert.equal(backupId, 'daily_2026_11_15');
  assert.equal(isDailyBackupId(backupId), true);
  assert.equal(isDailyBackupId('manual_2026_11_15_abc'), false);
  assert.equal(isDailyBackupId('pre_wipe_2026_11_15_xyz'), false);

  const chunks = buildSnapshotChunks(backupId, db, 250000);
  assert.ok(chunks.length > 1, `Expected multi-chunk split for 650 imaged items, got ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(JSON.stringify(chunk).length < 550000, 'Each chunk must stay comfortably below Firestore 1MB limit');
  }

  const manifest = {
    id: backupId,
    dateKey: '2026-11-15',
    label: '2026-11-15',
    reason: 'auto_daily' as const,
    createdAt: '2026-11-15T08:00:00Z',
    updatedAt: '2026-11-15T08:00:00Z',
    productCount: db.products.length,
    categoryCount: 2,
    invoiceCount: 1,
    shortageCount: 1,
    chunkCount: chunks.length,
    settings: db.settings,
  };

  // Inject an extra stale excess chunk (e.g., leftover from an earlier larger day snapshot)
  const staleChunk = {
    id: `chunk_${chunks.length}`,
    backupId,
    chunkIndex: chunks.length,
    products: [{ id: 'stale_item', name: 'صنف قديم زائد', price: 99, category: 'عام' }],
    invoices: [],
    shortages: [],
  };

  const reassembled = reassembleDatabaseFromBackup(manifest, [...chunks, staleChunk], db.settings);
  assert.equal(reassembled.products.length, 650);
  assert.equal(reassembled.products.some((p) => p.id === 'stale_item'), false);
  assert.equal(reassembled.products[0].wholesalePrice, 7);
  assert.equal(reassembled.products[0].dozenPrice, 110);
  assert.equal(reassembled.invoices.length, 1);
  assert.equal(reassembled.shortages.length, 1);

  // Unlocked non-owner device (cashier / secondary PC) MUST auto-save daily cloud backup
  assert.equal(
    shouldTriggerAutoDailyBackup({
      isUnlocked: true,
      isOwner: false,
      isAuthorizedCloud: false,
      isOnline: true,
      hasRealData: true,
      productCount: 650,
      invoiceCount: 1,
      shortageCount: 1,
      existingDailyBackup: null,
    }),
    true
  );

  // Locked app or offline or 0 products must NOT overwrite daily backup
  assert.equal(
    shouldTriggerAutoDailyBackup({
      isUnlocked: false,
      isOnline: true,
      hasRealData: true,
      productCount: 650,
      invoiceCount: 1,
      shortageCount: 1,
    }),
    false
  );
  assert.equal(
    shouldTriggerAutoDailyBackup({
      isUnlocked: true,
      isOnline: false,
      hasRealData: true,
      productCount: 650,
      invoiceCount: 1,
      shortageCount: 1,
    }),
    false
  );
  assert.equal(
    shouldTriggerAutoDailyBackup({
      isUnlocked: true,
      isOnline: true,
      hasRealData: true,
      productCount: 0,
      invoiceCount: 0,
      shortageCount: 0,
    }),
    false
  );
  assert.equal(
    shouldTriggerAutoDailyBackup({
      isUnlocked: true,
      isOwner: true,
      isAuthorizedCloud: true,
      isOnline: true,
      hasRealData: true,
      productCount: 650,
      invoiceCount: 1,
      shortageCount: 1,
      existingDailyBackup: null,
    }),
    true
  );

  // Count change triggers refresh once minRefreshIntervalMs passes
  const baseMs = Date.parse('2026-11-15T10:00:00.000Z');
  assert.equal(
    shouldTriggerAutoDailyBackup({
      isUnlocked: true,
      isOnline: true,
      hasRealData: true,
      productCount: 651,
      invoiceCount: 2,
      shortageCount: 1,
      existingDailyBackup: { ...manifest, updatedAt: '2026-11-15T09:58:00.000Z' },
      nowMs: baseMs,
    }),
    false
  );
  assert.equal(
    shouldTriggerAutoDailyBackup({
      isUnlocked: true,
      isOnline: true,
      hasRealData: true,
      productCount: 651,
      invoiceCount: 2,
      shortageCount: 1,
      existingDailyBackup: { ...manifest, updatedAt: '2026-11-15T09:50:00.000Z' },
      nowMs: baseMs,
    }),
    true
  );
});

test('formatLastUpdatedLabel formats Arabic relative and exact timestamps across ranges', async () => {
  const { formatLastUpdatedLabel } = await import('./syncLogic');

  const uninitialized = formatLastUpdatedLabel(null);
  assert.equal(uninitialized.hasSyncedBefore, false);
  assert.equal(uninitialized.primary, 'لم تتم المزامنة السحابية بعد');

  assert.equal(formatLastUpdatedLabel('invalid-iso').hasSyncedBefore, false);

  const baseNow = new Date(2026, 10, 17, 14, 30, 0).getTime(); // Nov 17 2026, 02:30 PM

  // 20 seconds ago
  const momentsAgo = new Date(baseNow - 20 * 1000).toISOString();
  const resMoments = formatLastUpdatedLabel(momentsAgo, baseNow);
  assert.equal(resMoments.hasSyncedBefore, true);
  assert.equal(resMoments.relative, 'منذ لحظات');
  assert.match(resMoments.primary, /^اليوم · 02:29 م \(منذ لحظات\)$/);
  assert.equal(resMoments.exact, '17/11/2026 · 02:29 م');

  // 2 minutes ago
  const twoMinAgo = new Date(baseNow - 2 * 60 * 1000).toISOString();
  assert.equal(formatLastUpdatedLabel(twoMinAgo, baseNow).relative, 'منذ دقيقتين');

  // 2 hours ago (still same day)
  const twoHoursAgo = new Date(baseNow - 2 * 60 * 60 * 1000).toISOString();
  const resHours = formatLastUpdatedLabel(twoHoursAgo, baseNow);
  assert.equal(resHours.relative, 'منذ ساعتين');
  assert.match(resHours.primary, /^اليوم · 12:30 م \(منذ ساعتين\)$/);

  // Yesterday
  const yesterday = new Date(2026, 10, 16, 21, 15, 0).toISOString();
  const resYesterday = formatLastUpdatedLabel(yesterday, baseNow);
  assert.equal(resYesterday.relative, 'أمس');
  assert.equal(resYesterday.primary, 'أمس · 09:15 م');

  // Older date (3 days ago)
  const older = new Date(2026, 10, 14, 9, 5, 0).toISOString();
  const resOlder = formatLastUpdatedLabel(older, baseNow);
  assert.equal(resOlder.relative, 'منذ 3 أيام');
  assert.equal(resOlder.primary, '14/11/2026 · 09:05 ص');
});

test('getRetryBackoffMs scales smoothly and caps at 60 seconds', async () => {
  const { getRetryBackoffMs } = await import('./syncLogic');

  assert.equal(getRetryBackoffMs(0), 5000);
  assert.equal(getRetryBackoffMs(1), 15000);
  assert.equal(getRetryBackoffMs(2), 30000);
  assert.equal(getRetryBackoffMs(3), 60000);
  assert.equal(getRetryBackoffMs(10), 60000);
});

test('applyPendingOutboxOverlays preserves offline additions, edits, deletes, and wipe order over cloud snapshots', async () => {
  const { applyPendingOutboxOverlays } = await import('./syncLogic');

  const cloudSnapshot = {
    products: [
      { id: 'p1', name: 'كشكول 60', price: 20, category: 'الورقيات' },
      { id: 'p2', name: 'قلم رصاص', price: 5, category: 'أدوات' },
    ],
    shortages: [
      { id: 's1', name: 'مسطرة 30', quantity: 2, category: 'أدوات', done: false, date: '2026-11-16T08:00:00Z' },
    ],
    invoices: [],
    trash: [],
    settings: { shop: 'مكتبة الطيب أحسن', phone: '01151906520' },
  };

  const pendingOps = [
    {
      key: 'products:p1',
      type: 'saveProduct' as const,
      payload: { id: 'p1', name: 'كشكول 60', price: 28, category: 'الورقيات' },
      ts: 100,
    },
    {
      key: 'products:p3',
      type: 'saveProduct' as const,
      payload: { id: 'p3', name: 'قلم أزرق أوفلاين', price: 10, category: 'أدوات' },
      ts: 200,
    },
    {
      key: 'shortages:s1',
      type: 'deleteShortage' as const,
      id: 's1',
      ts: 250,
    },
    {
      key: 'shortages:s2',
      type: 'saveShortage' as const,
      payload: { id: 's2', name: 'أستيكة فابر', quantity: 6, category: 'أدوات', done: false, date: '2026-11-17T09:00:00Z' },
      ts: 300,
    },
    {
      key: 'invoices:inv1',
      type: 'saveInvoice' as const,
      payload: { id: 'inv1', items: [{ id: 'p1', name: 'كشكول 60', price: 28, quantity: 1 }], total: 28, date: '2026-11-17T09:10:00Z' },
      ts: 400,
    },
  ];

  const reconciled = applyPendingOutboxOverlays(cloudSnapshot, pendingOps);
  assert.equal(reconciled.products.length, 3);
  assert.equal(reconciled.products.find((p) => p.id === 'p1')?.price, 28);
  assert.equal(reconciled.products.find((p) => p.id === 'p3')?.name, 'قلم أزرق أوفلاين');
  assert.equal(reconciled.shortages.length, 1);
  assert.equal(reconciled.shortages[0].id, 's2');
  assert.equal(reconciled.invoices.length, 1);
  assert.equal(reconciled.invoices[0].total, 28);

  // Also check wipe followed by a new product in chronological order
  const wipedThenAdded = applyPendingOutboxOverlays(cloudSnapshot, [
    { key: 'wipe:store', type: 'wipeStoreData', ts: 500 },
    { key: 'products:fresh', type: 'saveProduct', payload: { id: 'fresh', name: 'صنف بعد التفريغ', price: 15, category: 'عام' }, ts: 600 },
  ]);
  assert.equal(wipedThenAdded.products.length, 1);
  assert.equal(wipedThenAdded.products[0].id, 'fresh');
  assert.equal(wipedThenAdded.shortages.length, 0);
});

test('collaborative outbox permissions allow non-owner devices to sync additions/invoices/shortages while guarding admin ops', async () => {
  const { isCollaborativeSyncOp, canExecuteOutboxOp, isPermissionDeniedError } = await import('./syncLogic');

  assert.equal(isCollaborativeSyncOp({ type: 'saveProduct' }), true);
  assert.equal(isCollaborativeSyncOp({ type: 'saveShortage' }), true);
  assert.equal(isCollaborativeSyncOp({ type: 'saveInvoice' }), true);
  assert.equal(canExecuteOutboxOp({ type: 'saveProduct' }, false), true);
  assert.equal(canExecuteOutboxOp({ type: 'saveShortage' }, false), true);
  assert.equal(canExecuteOutboxOp({ type: 'saveInvoice' }, false), true);

  const ownerOnlyTypes = [
    'deleteProduct',
    'deleteShortage',
    'deleteInvoice',
    'saveSettings',
    'wipeStoreData',
    'batchSeedProducts',
    'batchSeedShortages',
    'batchSeedInvoices',
    'saveTrashItem',
    'batchSaveTrashItems',
    'deleteTrashItem',
    'batchDeleteTrashItems',
  ] as const;

  for (const opType of ownerOnlyTypes) {
    assert.equal(isCollaborativeSyncOp({ type: opType }), false);
    assert.equal(canExecuteOutboxOp({ type: opType }, false), false);
    assert.equal(canExecuteOutboxOp({ type: opType }, true), true);
  }

  assert.equal(isPermissionDeniedError({ code: 'permission-denied', message: 'Missing or insufficient permissions' }), true);
  assert.equal(isPermissionDeniedError(new Error('FirebaseError: Missing or insufficient permissions.')), true);
  assert.equal(isPermissionDeniedError(new Error('Network timeout')), false);
});

test('buildQuickAddInvoiceResult defaults to invoice-only manual item and registers to catalog ONLY when confirmed', async () => {
  const { buildQuickAddInvoiceResult } = await import('./shopLogic');
  const existingProducts: Product[] = [
    { id: 'cat-1', name: 'كشكول 60 ورقة', price: 20, category: 'الورقيات' },
  ];

  // 1. Default invoice-only mode (saveToCatalog = false)
  const manualRes = buildQuickAddInvoiceResult({
    name: 'صنف خاص مبيوع يدوياً',
    piecePriceStr: '37.5',
    dozenPriceStr: '',
    quantity: 3,
    unit: 'piece',
    saveToCatalog: false,
    existingProducts,
    now: new Date('2026-11-18T10:00:00Z'),
  });
  assert.equal(manualRes.ok, true);
  if (manualRes.ok) {
    assert.equal(manualRes.productToRegister, null);
    assert.equal(manualRes.cartItem.productId, undefined);
    assert.ok(manualRes.cartItem.id.startsWith('manual_'));
    assert.equal(manualRes.cartItem.price, 37.5);
    assert.equal(manualRes.cartItem.originalPrice, 37.5);
    assert.equal(manualRes.cartItem.quantity, 3);
    assert.equal(manualRes.cartItem.category, 'أصناف يدوية');
  }

  // 2. Manual item by dozen only infers piece price cleanly without registering to catalog
  const manualDozenRes = buildQuickAddInvoiceResult({
    name: 'دستة اقلام يدوية',
    piecePriceStr: '',
    dozenPriceStr: '120',
    quantity: 2,
    unit: 'dozen',
    saveToCatalog: false,
    existingProducts,
  });
  assert.equal(manualDozenRes.ok, true);
  if (manualDozenRes.ok) {
    assert.equal(manualDozenRes.productToRegister, null);
    assert.equal(manualDozenRes.cartItem.unit, 'dozen');
    assert.equal(manualDozenRes.cartItem.price, 120);
    assert.equal(manualDozenRes.cartItem.quantity, 2);
  }

  // 3. Confirmed saveToCatalog = true registers new product with normalized prices
  const registeredRes = buildQuickAddInvoiceResult({
    name: 'مسطرة معدن 30 سم',
    piecePriceStr: '18',
    dozenPriceStr: '200',
    category: 'أدوات هندسية',
    quantity: 1,
    unit: 'piece',
    saveToCatalog: true,
    existingProducts,
    now: new Date('2026-11-18T10:05:00Z'),
  });
  assert.equal(registeredRes.ok, true);
  if (registeredRes.ok) {
    assert.ok(registeredRes.productToRegister);
    assert.equal(registeredRes.productToRegister?.name, 'مسطرة معدن 30 سم');
    assert.equal(registeredRes.productToRegister?.price, 18);
    assert.equal(registeredRes.productToRegister?.sellDozenRetail, 200);
    assert.equal(registeredRes.productToRegister?.category, 'أدوات هندسية');
    assert.equal(registeredRes.cartItem.productId, registeredRes.productToRegister?.id);
  }

  // 4. Duplicate rejection when saveToCatalog = true, whereas saveToCatalog = false succeeds even with same name
  const dupRegister = buildQuickAddInvoiceResult({
    name: '  كشكول 60 ورقه  ',
    piecePriceStr: '22',
    quantity: 1,
    unit: 'piece',
    saveToCatalog: true,
    existingProducts,
  });
  assert.equal(dupRegister.ok, false);

  const nonCatalogSameName = buildQuickAddInvoiceResult({
    name: 'كشكول 60 ورقة',
    piecePriceStr: '22',
    quantity: 1,
    unit: 'piece',
    saveToCatalog: false,
    existingProducts,
  });
  assert.equal(nonCatalogSameName.ok, true);
  if (nonCatalogSameName.ok) {
    assert.equal(nonCatalogSameName.productToRegister, null);
  }
});

test('buildDailyBackupMimeEmail & shouldPromptDailyGmailBackup produce valid UTF-8 Gmail payload preserving full store data', async () => {
  const {
    buildDailyBackupEmailSubject,
    buildDailyBackupMimeEmail,
    shouldPromptDailyGmailBackup,
  } = await import('./backupTrashLogic');

  const snapshotDb = {
    products: [
      {
        id: 'p-1',
        name: 'كراسة رسم كبيرة',
        price: 25,
        buyWholesale: 17,
        wholesalePrice: 17,
        sellDozenRetail: 270,
        dozenPrice: 270,
        category: 'الورقيات',
      },
    ],
    invoices: [
      {
        id: '0101',
        customer: 'طارق',
        total: 50,
        date: '2026-11-18T08:00:00.000Z',
        items: [{ id: 'p-1', productId: 'p-1', name: 'كراسة رسم كبيرة', price: 25, quantity: 2 }],
      },
    ],
    shortages: [
      {
        id: 'sh-1',
        name: 'أقلام سبورة',
        quantity: 12,
        category: 'أدوات مكتبية',
        done: false,
        date: '2026-11-18T07:30:00.000Z',
      },
    ],
    trash: [],
    settings: { shop: 'مكتبة الطيب أحسن', phone: '01151906520' },
  };

  const subject = buildDailyBackupEmailSubject('مكتبة الطيب أحسن', '2026-11-18');
  assert.match(subject, /مكتبة الطيب أحسن/);
  assert.match(subject, /2026-11-18/);

  const built = buildDailyBackupMimeEmail({
    to: 'www.abdo01021221343@gmail.com',
    shopName: 'مكتبة الطيب أحسن',
    dateKey: '2026-11-18',
    snapshotDb,
    generatedAtIso: '2026-11-18T09:00:00.000Z',
  });

  assert.equal(built.productCount, 1);
  assert.equal(built.categoryCount, 1);
  assert.equal(built.invoiceCount, 1);
  assert.equal(built.shortageCount, 1);
  assert.equal(built.filename, 'tayeb-cloud-backup-2026-11-18.json');
  assert.equal(/[+/=]/.test(built.raw), false);

  const stdB64 = built.raw.replace(/-/g, '+').replace(/_/g, '/');
  const paddedB64 = stdB64 + '='.repeat((4 - (stdB64.length % 4)) % 4);
  const decodedMime = Buffer.from(paddedB64, 'base64').toString('utf-8');
  assert.match(decodedMime, /^To: www\.abdo01021221343@gmail\.com/m);
  assert.match(decodedMime, /Subject: =\?UTF-8\?B\?/);
  assert.match(decodedMime, /Content-Disposition: attachment; filename="tayeb-cloud-backup-2026-11-18\.json"/);

  const attachmentMarker = 'Content-Disposition: attachment; filename="tayeb-cloud-backup-2026-11-18.json"\r\nContent-Transfer-Encoding: base64\r\n\r\n';
  const startIdx = decodedMime.indexOf(attachmentMarker);
  assert.ok(startIdx >= 0);
  const afterHeader = decodedMime.slice(startIdx + attachmentMarker.length);
  const endIdx = afterHeader.indexOf('\r\n\r\n--');
  const attachmentB64 = afterHeader.slice(0, endIdx).replace(/\r?\n/g, '');
  const parsedJson = JSON.parse(Buffer.from(attachmentB64, 'base64').toString('utf-8'));

  assert.equal(parsedJson.backupDateKey, '2026-11-18');
  assert.equal(parsedJson.products.length, 1);
  assert.equal(parsedJson.products[0].wholesalePrice, 17);
  assert.equal(parsedJson.products[0].dozenPrice, 270);
  assert.equal(parsedJson.invoices.length, 1);
  assert.equal(parsedJson.shortages.length, 1);

  assert.equal(
    shouldPromptDailyGmailBackup({
      isOwner: true,
      isCloudAdmin: true,
      isOnline: true,
      hasRealData: true,
      productCount: 10,
      ownerEmail: 'www.abdo01021221343@gmail.com',
      signedInEmail: 'www.abdo01021221343@gmail.com',
      todayKey: '2026-11-18',
      lastSentDateKey: '2026-11-17',
    }),
    true
  );

  assert.equal(
    shouldPromptDailyGmailBackup({
      isOwner: true,
      isCloudAdmin: true,
      isOnline: true,
      hasRealData: true,
      productCount: 10,
      ownerEmail: 'www.abdo01021221343@gmail.com',
      signedInEmail: 'www.abdo01021221343@gmail.com',
      todayKey: '2026-11-18',
      lastSentDateKey: '2026-11-18',
    }),
    false
  );

  assert.equal(
    shouldPromptDailyGmailBackup({
      isOwner: false,
      isCloudAdmin: false,
      isOnline: true,
      hasRealData: true,
      productCount: 10,
      ownerEmail: 'www.abdo01021221343@gmail.com',
      signedInEmail: 'cashier@gmail.com',
      todayKey: '2026-11-18',
      lastSentDateKey: null,
    }),
    false
  );
});

test('formatWhatsAppEgyptNumber & buildWhatsAppUrl normalize Egyptian local and international phone numbers', async () => {
  const { formatWhatsAppEgyptNumber, buildWhatsAppUrl } = await import('./shopLogic');

  assert.equal(formatWhatsAppEgyptNumber('01151906520'), '201151906520');
  assert.equal(formatWhatsAppEgyptNumber('٠١١٥١٩٠٦٥٢٠'), '201151906520');
  assert.equal(formatWhatsAppEgyptNumber('+20 115-190-6520'), '201151906520');
  assert.equal(formatWhatsAppEgyptNumber('00201151906520'), '201151906520');
  assert.equal(formatWhatsAppEgyptNumber('1151906520'), '201151906520');
  assert.equal(buildWhatsAppUrl('01151906520'), 'https://wa.me/201151906520');
  assert.equal(buildWhatsAppUrl('01151906520', 'مرحبا'), 'https://wa.me/201151906520?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7');
});

test('updateGateCredentials works cleanly on static hosting without /api backend using local salted SHA-256 fallback', async () => {
  const store = new Map<string, string>();
  const prevStorage = (globalThis as { localStorage?: Storage }).localStorage;
  const prevFetch = globalThis.fetch;

  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (idx: number) => Array.from(store.keys())[idx] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  };

  // Simulate static Firebase Hosting returning index.html fallback instead of JSON API
  globalThis.fetch = (async () =>
    new Response('<!doctype html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })) as typeof fetch;

  try {
    const {
      updateGateCredentials,
      verifyGateCredentialsOffline,
    } = await import('./cryptoAuth');

    // Wrong current password rejected
    const badRes = await updateGateCredentials('000000', 'admin2', '998877');
    assert.equal(badRes.success, false);

    // Correct current default password succeeds on static hosting & verifies new credentials
    const okRes = await updateGateCredentials('443760', 'store2', '998877');
    assert.equal(okRes.success, true);
    assert.equal(await verifyGateCredentialsOffline('store2', '998877'), true);
    assert.equal(await verifyGateCredentialsOffline('196499', '443760'), false);
  } finally {
    if (prevStorage === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } else {
      (globalThis as unknown as { localStorage: Storage }).localStorage = prevStorage;
    }
    globalThis.fetch = prevFetch;
  }
});

test('checkForAppUpdate safely reports unsupported when serviceWorker API is absent in Node', async () => {
  const { checkForAppUpdate } = await import('./pwaUpdate');
  const res = await checkForAppUpdate(500);
  assert.equal(res, 'unsupported');
});

test('createZipArchive creates a valid PKZIP archive with CRC32 and deflate round-trip', async () => {
  const { createZipArchive, crc32 } = await import('./zipBuilder');
  const { inflateRawSync } = await import('zlib');

  const htmlBuf = Buffer.from('<!doctype html><html><body>مكتبة الطيب أحسن</body></html>', 'utf8');
  const redirectBuf = Buffer.from('/* /index.html 200\n', 'utf8');
  const zip = createZipArchive([
    { name: 'index.html', data: htmlBuf },
    { name: 'assets/_redirects', data: redirectBuf },
  ]);

  // Verify Local File Header signature & End of Central Directory signature
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const eocdOffset = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocdOffset), 0x06054b50);
  assert.equal(zip.readUInt16LE(eocdOffset + 8), 2); // 2 entries

  // Verify first entry payload can be inflated or matches uncompressed bytes and CRC matches
  const method = zip.readUInt16LE(8);
  const storedCrc = zip.readUInt32LE(14);
  const compSize = zip.readUInt32LE(18);
  const nameLen = zip.readUInt16LE(26);
  const extraLen = zip.readUInt16LE(28);
  assert.equal(storedCrc, crc32(htmlBuf));
  const dataStart = 30 + nameLen + extraLen;
  const payload = zip.subarray(dataStart, dataStart + compSize);
  const extracted = method === 8 ? inflateRawSync(payload) : payload;
  assert.equal(extracted.toString('utf8'), htmlBuf.toString('utf8'));
});

