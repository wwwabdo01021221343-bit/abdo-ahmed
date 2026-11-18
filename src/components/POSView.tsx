import React, { useState, useMemo, useDeferredValue } from 'react';
import { 
  ShoppingCart, 
  Trash2, 
  Plus, 
  Minus, 
  Search, 
  User, 
  Check, 
  Printer, 
  MessageCircle, 
  Share2, 
  History, 
  FileText, 
  X,
  AlertCircle,
  Copy,
  Receipt,
  Layers,
  Folder,
  Grid,
  Lock,
  PackagePlus,
  RotateCcw
} from 'lucide-react';
import { AppDatabase, CartItem, Invoice, Product } from '../types';
import { 
  adjustCartItemPrice,
  buildQuickAddInvoiceResult,
  calculateCartTotal, 
  formatCurrency, 
  generateInvoiceWhatsAppText, 
  matchesNormalizedTokens,
  normalizeArabicSearchText,
  formatDateTime,
  resetCartItemPrice,
  sortProducts,
  tokenizeArabicSearch,
  updateCartItemPrice
} from '../utils/shopLogic';
import { soundFx } from '../utils/audioFeedback';
import { ProductSortBar, useProductSort } from './ProductSortBar';
import { ConfirmModal } from './ConfirmModal';

interface POSViewProps {
  db: AppDatabase;
  cart: CartItem[];
  setCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
  onSaveInvoice: (invoice: Invoice) => void;
  onDeleteInvoice: (invoiceId: string) => void;
  selectedInvoice: Invoice | null;
  setSelectedInvoice: (invoice: Invoice | null) => void;
  isOwner?: boolean;
  onRequestOwnerLogin?: () => void;
  onAddProduct?: (product: Product) => void;
}

export const POSView: React.FC<POSViewProps> = ({
  db,
  cart,
  setCart,
  onSaveInvoice,
  onDeleteInvoice,
  selectedInvoice,
  setSelectedInvoice,
  isOwner = false,
  onRequestOwnerLogin,
  onAddProduct
}) => {
  const [activeCategory, setActiveCategory] = useState<string>('الكل');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [customerName, setCustomerName] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'cashier' | 'history'>('cashier');
  const [historySearch, setHistorySearch] = useState<string>('');
  const deferredHistorySearch = useDeferredValue(historySearch);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [copiedNotification, setCopiedNotification] = useState<boolean>(false);
  const [groupByCategory, setGroupByCategory] = useState<boolean>(true);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const { sortField, sortDirection, selectSortField, toggleDirection } = useProductSort();

  // Quick Add Manual / Unlisted Product State
  const [isQuickAddModalOpen, setIsQuickAddModalOpen] = useState<boolean>(false);
  const [quickAddName, setQuickAddName] = useState<string>('');
  const [quickAddPrice, setQuickAddPrice] = useState<string>('');
  const [quickAddDozenPrice, setQuickAddDozenPrice] = useState<string>('');
  const [quickAddCategory, setQuickAddCategory] = useState<string>('');
  const [quickAddQty, setQuickAddQty] = useState<number>(1);
  const [quickAddUnit, setQuickAddUnit] = useState<'piece' | 'dozen'>('piece');
  const [quickAddSaveToCatalog, setQuickAddSaveToCatalog] = useState<boolean>(false);
  const [quickAddError, setQuickAddError] = useState<string>('');
  const [confirmClearCartOpen, setConfirmClearCartOpen] = useState<boolean>(false);
  const [pendingDeleteInvoice, setPendingDeleteInvoice] = useState<Invoice | null>(null);

  // Pre-sort & pre-normalize products once per products or sort update
  const indexedProducts = useMemo(() => {
    return sortProducts(db.products, sortField, sortDirection).map((product) => {
      const cleanCategory = (product.category || 'بدون مجموعة').trim() || 'بدون مجموعة';
      return {
        product,
        cleanCategory,
        normName: normalizeArabicSearchText(product.name),
        normCat: normalizeArabicSearchText(cleanCategory),
      };
    });
  }, [db.products, sortField, sortDirection]);

  // O(1) cart quantities lookup map for product badges
  const cartQtyMap = useMemo(() => {
    const map = new Map<string, { piece: number; dozen: number }>();
    for (const item of cart) {
      const pid = item.productId || (item.id.endsWith('-dozen') ? item.id.slice(0, -6) : item.id);
      const entry = map.get(pid) || { piece: 0, dozen: 0 };
      if (item.unit === 'dozen') {
        entry.dozen += item.quantity;
      } else {
        entry.piece += item.quantity;
      }
      map.set(pid, entry);
    }
    return map;
  }, [cart]);

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of indexedProducts) {
      set.add(item.cleanCategory);
    }
    return ['الكل', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'))];
  }, [indexedProducts]);

  // Filtered products for cashier (already sorted, supports any word order!)
  const filteredProducts = useMemo(() => {
    const tokens = tokenizeArabicSearch(deferredSearchQuery);
    return indexedProducts
      .filter((item) => {
        if (activeCategory !== 'الكل' && item.cleanCategory !== activeCategory) return false;
        if (tokens.length === 0) return true;
        return matchesNormalizedTokens(tokens, item.normName, item.normCat);
      })
      .map((item) => item.product);
  }, [indexedProducts, activeCategory, deferredSearchQuery]);

  // Grouped products by category
  const groupedProducts = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filteredProducts) {
      const cat = (p.category || 'بدون مجموعة').trim() || 'بدون مجموعة';
      if (!map.has(cat)) {
        map.set(cat, []);
      }
      map.get(cat)!.push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'ar'));
  }, [filteredProducts]);

  // Grouped cart items by category so invoice items belonging to the same group stay together
  const groupedCart = useMemo(() => {
    const map = new Map<string, CartItem[]>();
    for (const item of cart) {
      const cat = (item.category || 'بدون مجموعة').trim() || 'بدون مجموعة';
      if (!map.has(cat)) {
        map.set(cat, []);
      }
      map.get(cat)!.push(item);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'ar'));
  }, [cart]);

  // Grouped receipt items by category for preview and thermal printing
  const groupedReceiptItems = useMemo(() => {
    if (!selectedInvoice) return [];
    const map = new Map<string, CartItem[]>();
    for (const item of selectedInvoice.items) {
      const cat = (item.category || 'بدون مجموعة').trim() || 'بدون مجموعة';
      if (!map.has(cat)) {
        map.set(cat, []);
      }
      map.get(cat)!.push(item);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'ar'));
  }, [selectedInvoice]);

  // Cart actions: support selling by piece ('piece') or by dozen ('dozen')
  const addToCart = (product: Product, unit: 'piece' | 'dozen' = 'piece') => {
    soundFx.playClick();
    const isDozen = unit === 'dozen';
    const dozenSellingPrice = (product.sellDozenRetail != null && product.sellDozenRetail > 0)
      ? product.sellDozenRetail
      : product.price * 12;
    const finalPrice = isDozen ? dozenSellingPrice : product.price;
    const cartItemId = isDozen ? `${product.id}-dozen` : product.id;

    setCart(prev => {
      const existing = prev.find(item => item.id === cartItemId);
      if (existing) {
        return prev.map(item =>
          item.id === cartItemId ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, {
        id: cartItemId,
        productId: product.id,
        name: product.name,
        price: finalPrice,
        originalPrice: finalPrice,
        quantity: 1,
        category: product.category,
        unit: isDozen ? 'dozen' : 'piece'
      }];
    });
  };

  // Toggle cart item between piece and dozen
  const toggleItemUnit = (itemId: string) => {
    setPriceDrafts((prev) => {
      if (!(itemId in prev)) return prev;
      const copy = { ...prev };
      delete copy[itemId];
      return copy;
    });
    setCart(prev => {
      return prev.map(item => {
        if (item.id === itemId) {
          const matchedProduct = db.products.find(p => p.id === (item.productId || item.id.replace('-dozen', '')));
          const newUnit: 'piece' | 'dozen' = item.unit === 'dozen' ? 'piece' : 'dozen';
          let newPrice = item.price;
          let newName = item.name;

          if (matchedProduct) {
            if (newUnit === 'dozen') {
              newPrice = (matchedProduct.sellDozenRetail != null && matchedProduct.sellDozenRetail > 0)
                ? matchedProduct.sellDozenRetail
                : matchedProduct.price * 12;
              newName = matchedProduct.name;
            } else {
              newPrice = matchedProduct.price;
              newName = matchedProduct.name;
            }
          } else {
            // Unlisted product
            if (newUnit === 'dozen') {
              newPrice = item.price * 12;
            } else {
              newPrice = Math.max(0.25, Math.round((item.price / 12) * 100) / 100);
            }
          }

          soundFx.playClick();
          return {
            ...item,
            unit: newUnit,
            price: newPrice,
            originalPrice: newPrice,
            name: newName
          };
        }
        return item;
      });
    });
  };

  const updateQuantity = (itemId: string, delta: number) => {
    setCart(prev => {
      return prev.map(item => {
        if (item.id === itemId) {
          const newQty = item.quantity + delta;
          return newQty > 0 ? { ...item, quantity: newQty } : item;
        }
        return item;
      }).filter(item => item.quantity > 0);
    });
  };

  const setDirectQuantity = (itemId: string, val: string) => {
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) return;
    setCart(prev => prev.map(item => item.id === itemId ? { ...item, quantity: num } : item));
  };

  const handlePriceInputChange = (itemId: string, rawVal: string) => {
    setPriceDrafts((prev) => ({ ...prev, [itemId]: rawVal }));
    if (rawVal.trim() === '' || rawVal.endsWith('.')) return;
    const parsed = parseFloat(rawVal);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      setCart((prev) => updateCartItemPrice(prev, itemId, parsed));
    }
  };

  const handlePriceInputCommit = (itemId: string) => {
    const draft = priceDrafts[itemId];
    if (draft !== undefined) {
      const parsed = parseFloat(draft);
      if (!Number.isNaN(parsed) && parsed >= 0) {
        setCart((prev) => updateCartItemPrice(prev, itemId, parsed));
      }
      setPriceDrafts((prev) => {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      });
    }
  };

  const handleAdjustItemPrice = (itemId: string, delta: number) => {
    soundFx.playClick();
    setPriceDrafts((prev) => {
      if (!(itemId in prev)) return prev;
      const copy = { ...prev };
      delete copy[itemId];
      return copy;
    });
    setCart((prev) => adjustCartItemPrice(prev, itemId, delta));
  };

  const handleResetItemPrice = (itemId: string) => {
    soundFx.playClick();
    setPriceDrafts((prev) => {
      if (!(itemId in prev)) return prev;
      const copy = { ...prev };
      delete copy[itemId];
      return copy;
    });
    setCart((prev) => resetCartItemPrice(prev, itemId));
  };

  const removeFromCart = (itemId: string) => {
    setPriceDrafts((prev) => {
      if (!(itemId in prev)) return prev;
      const copy = { ...prev };
      delete copy[itemId];
      return copy;
    });
    setCart(prev => prev.filter(item => item.id !== itemId));
  };

  const clearCart = () => {
    if (cart.length === 0) return;
    setConfirmClearCartOpen(true);
  };

  const confirmClearCart = () => {
    setCart([]);
    setPriceDrafts({});
    setCustomerName('');
    setEditingInvoiceId(null);
    setConfirmClearCartOpen(false);
  };

  const cartTotal = calculateCartTotal(cart);

  // Complete and save invoice
  const handleSaveInvoice = () => {
    if (cart.length === 0) return;

    let invoiceId = editingInvoiceId;
    if (!invoiceId) {
      // Generate clean sequential ID
      const maxNum = db.invoices.reduce((max, inv) => {
        const n = parseInt(inv.id, 10);
        return !isNaN(n) && n > max ? n : max;
      }, 0);
      invoiceId = String(maxNum + 1).padStart(4, '0');
    }

    const now = new Date().toISOString();
    const existing = editingInvoiceId ? db.invoices.find(x => x.id === editingInvoiceId) : null;

    const newInvoice: Invoice = {
      id: invoiceId,
      customer: customerName.trim() || undefined,
      items: [...cart],
      total: cartTotal,
      date: existing ? existing.date : now,
      updatedAt: now
    };

    onSaveInvoice(newInvoice);
    setSelectedInvoice(newInvoice);
    setCart([]);
    setCustomerName('');
    setEditingInvoiceId(null);
  };

  // Edit past invoice (Protected: Store Owner Only)
  const handleEditPastInvoice = (inv: Invoice) => {
    if (!isOwner) {
      soundFx.playWarning();
      onRequestOwnerLogin?.();
      return;
    }
    setEditingInvoiceId(inv.id);
    setCustomerName(inv.customer || '');
    setPriceDrafts({});
    setCart(
      inv.items.map((item) => {
        const matchedProduct = db.products.find(
          (p) => p.id === (item.productId || item.id.replace('-dozen', ''))
        );
        const catalogPrice = matchedProduct
          ? item.unit === 'dozen'
            ? matchedProduct.sellDozenRetail != null && matchedProduct.sellDozenRetail > 0
              ? matchedProduct.sellDozenRetail
              : matchedProduct.price * 12
            : matchedProduct.price
          : item.price;
        return {
          ...item,
          originalPrice: item.originalPrice ?? catalogPrice,
        };
      })
    );
    setActiveTab('cashier');
  };

  // Filtered past invoices (supports multi-word order-independent matching across invoice ID and customer name)
  const filteredInvoices = useMemo(() => {
    const tokens = tokenizeArabicSearch(deferredHistorySearch);
    if (tokens.length === 0) return db.invoices;
    return db.invoices.filter((inv) =>
      matchesNormalizedTokens(
        tokens,
        inv.id.toLowerCase(),
        inv.customer ? normalizeArabicSearchText(inv.customer) : ''
      )
    );
  }, [db.invoices, deferredHistorySearch]);

  return (
    <div className="space-y-4">
      {/* Tab Switcher: Cashier POS vs Invoice History */}
      <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-200">
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('cashier')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors ${
              activeTab === 'cashier'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            <span>نقطة البيع (الكاشير السريع)</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors ${
              activeTab === 'history'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <History className="w-4 h-4" />
            <span>سجل الفواتير السابقة ({db.invoices.length})</span>
          </button>
        </div>

        {editingInvoiceId && (
          <div className="flex items-center gap-2 text-xs bg-amber-50 text-amber-800 px-3 py-1.5 rounded-lg border border-amber-200">
            <span>تعديل فاتورة رقم #{editingInvoiceId}</span>
            <button
              onClick={() => {
                setEditingInvoiceId(null);
                setCart([]);
                setCustomerName('');
              }}
              className="text-amber-900 hover:underline font-bold"
            >
              إلغاء التعديل
            </button>
          </div>
        )}
      </div>

      {activeTab === 'cashier' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Products Grid (7 cols) */}
          <div className="lg:col-span-7 xl:col-span-8 space-y-3">
            {/* Search & Category Filter */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3 shadow-sm">
              <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="ابحث عن صنف بالاسم أو التصنيف لإضافته للفاتورة..."
                    className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:bg-white rounded-xl py-2.5 px-4 text-sm font-medium outline-none transition-all"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute left-3 top-2.5 text-xs text-slate-400 hover:text-slate-600 px-1.5 py-0.5 cursor-pointer"
                    >
                      مسح
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setQuickAddName(searchQuery.trim());
                    setQuickAddPrice('');
                    setQuickAddDozenPrice('');
                    setQuickAddCategory(activeCategory !== 'الكل' ? activeCategory : '');
                    setQuickAddQty(1);
                    setQuickAddUnit('piece');
                    setQuickAddSaveToCatalog(false);
                    setQuickAddError('');
                    setIsQuickAddModalOpen(true);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-xs shrink-0 cursor-pointer"
                  title="إضافة صنف وتسعيره يدوياً لهذه الفاتورة فقط أو تأكيد حفظه بالأصناف"
                >
                  <PackagePlus className="w-4 h-4" />
                  <span>+ صنف يدوي</span>
                </button>
              </div>

              {/* Category Pills & Grouping Toggle */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs flex-1">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      className={`px-3 py-1.5 rounded-lg font-semibold transition-all whitespace-nowrap ${
                        activeCategory === cat
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setGroupByCategory(!groupByCategory)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 shrink-0 border transition-colors cursor-pointer ${
                    groupByCategory
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                      : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}
                  title={groupByCategory ? 'الأصناف مرتبة في مجموعات متتالية' : 'عرض شبكي'}
                >
                  <Layers className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="hidden sm:inline">{groupByCategory ? 'مقسم حسب المجموعات' : 'شبكة واحدة'}</span>
                </button>
              </div>

              {/* Sort Controls */}
              <div className="pt-2 border-t border-slate-100">
                <ProductSortBar
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSelectField={selectSortField}
                  onToggleDirection={toggleDirection}
                  compact
                  accent="emerald"
                />
              </div>
            </div>

            {/* Products Display Area: Grouped Consecutive Sections */}
            <div className="max-h-[640px] overflow-y-auto pr-1 space-y-4">
              {groupByCategory && activeCategory === 'الكل' ? (
                /* Grouped by Category: Educational Books together, Stationery together, etc. */
                groupedProducts.map(([categoryName, productsInGroup]) => (
                  <div key={categoryName} className="space-y-2 bg-slate-50/60 p-3 rounded-2xl border border-slate-200/80">
                    <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                      <div className="flex items-center gap-2">
                        <Folder className="w-4 h-4 text-emerald-600" />
                        <h3 className="font-bold text-xs sm:text-sm text-slate-900">
                          {categoryName}
                        </h3>
                      </div>
                      <span className="bg-white text-slate-600 text-[11px] font-bold px-2 py-0.5 rounded-md border border-slate-200">
                        {productsInGroup.length} صنف
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
                      {productsInGroup.map((product) => {
                        const cartCounts = cartQtyMap.get(product.id);
                        const pieceQty = cartCounts?.piece || 0;
                        const dozenQty = cartCounts?.dozen || 0;
                        const dozenPrice = (product.sellDozenRetail != null && product.sellDozenRetail > 0)
                          ? product.sellDozenRetail
                          : product.price * 12;

                        return (
                          <div
                            key={product.id}
                            className="perf-item bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 hover:border-emerald-500/80 hover:shadow-md transition-all text-right flex flex-col justify-between group relative overflow-hidden"
                          >
                            {/* Badges in cart */}
                            <div className="absolute top-2 left-2 flex items-center gap-1 z-10">
                              {pieceQty > 0 && (
                                <span className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow" title={`${pieceQty} قطعة في السلة`}>
                                  {pieceQty}ق
                                </span>
                              )}
                              {dozenQty > 0 && (
                                <span className="bg-amber-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow" title={`${dozenQty} دستة في السلة`}>
                                  {dozenQty}د
                                </span>
                              )}
                            </div>

                            <div className="flex items-start gap-2 w-full">
                              {product.image && (
                                <img
                                  src={product.image}
                                  alt={product.name}
                                  className="w-10 h-10 rounded-lg object-cover shrink-0 border border-slate-200 bg-slate-50"
                                  loading="lazy"
                                  decoding="async"
                                />
                              )}
                              <div className="w-full min-w-0">
                                <span className="text-[10px] text-slate-400 block mb-0.5 truncate">
                                  {product.category}
                                </span>
                                <h4 className="font-bold text-slate-900 text-xs sm:text-sm line-clamp-2 leading-snug group-hover:text-emerald-700 transition-colors">
                                  {product.name}
                                </h4>
                              </div>
                            </div>

                            {/* Dual Selling Actions: Piece & Dozen */}
                            <div className="mt-2.5 pt-1.5 border-t border-slate-100 flex flex-col gap-1 w-full">
                              {/* Piece selling */}
                              <div className="flex items-center justify-between w-full">
                                <span className="font-black text-emerald-700 text-xs sm:text-sm">
                                  {formatCurrency(product.price)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => addToCart(product, 'piece')}
                                  className="text-[10px] sm:text-[11px] bg-slate-100 hover:bg-emerald-600 hover:text-white text-slate-700 font-bold px-2 py-0.5 rounded-md transition-colors cursor-pointer"
                                  title="إضافة بالقطعة للفاتورة"
                                >
                                  + قطعة
                                </button>
                              </div>

                              {/* Dozen selling */}
                              <div className="flex items-center justify-between w-full bg-amber-50/80 border border-amber-200/80 rounded-md px-1.5 py-0.5">
                                <span className="font-bold text-amber-900 text-[10px] sm:text-[11px]">
                                  {formatCurrency(dozenPrice)}
                                  <span className="text-[9px] text-amber-700 font-normal mr-0.5">/دستة</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => addToCart(product, 'dozen')}
                                  className="text-[10px] bg-amber-500 hover:bg-amber-600 text-white font-bold px-1.5 py-0.5 rounded transition-all cursor-pointer shadow-2xs"
                                  title="إضافة دستة كاملة بسعر بيع الدستة للفاتورة"
                                >
                                  + دستة
                                </button>
                              </div>

                              {/* Owner-only Wholesale Purchase Price (After Retail & Dozen Retail) */}
                              {isOwner && (
                                <div className="flex items-center justify-between w-full bg-amber-100/70 border border-amber-300/80 rounded-md px-1.5 py-0.5 text-[10px]">
                                  <span className="font-bold text-amber-900 flex items-center gap-1">
                                    <Lock className="w-2.5 h-2.5 text-amber-700 shrink-0" />
                                    <span>شراء جملة:</span>
                                  </span>
                                  <span className="font-black text-amber-950 font-mono">
                                    {product.buyWholesale != null ? formatCurrency(product.buyWholesale) : '—'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                /* Flat Grid for specific category or toggle */
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {filteredProducts.map((product) => {
                    const cartCounts = cartQtyMap.get(product.id);
                    const pieceQty = cartCounts?.piece || 0;
                    const dozenQty = cartCounts?.dozen || 0;
                    const dozenPrice = (product.sellDozenRetail != null && product.sellDozenRetail > 0)
                      ? product.sellDozenRetail
                      : product.price * 12;

                    return (
                      <div
                        key={product.id}
                        className="perf-item bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 hover:border-emerald-500/80 hover:shadow-md transition-all text-right flex flex-col justify-between group relative overflow-hidden"
                      >
                        <div className="absolute top-2 left-2 flex items-center gap-1 z-10">
                          {pieceQty > 0 && (
                            <span className="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow" title={`${pieceQty} قطعة في السلة`}>
                              {pieceQty}ق
                            </span>
                          )}
                          {dozenQty > 0 && (
                            <span className="bg-amber-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow" title={`${dozenQty} دستة في السلة`}>
                              {dozenQty}د
                            </span>
                          )}
                        </div>

                        <div className="flex items-start gap-2 w-full">
                          {product.image && (
                            <img
                              src={product.image}
                              alt={product.name}
                              className="w-10 h-10 rounded-lg object-cover shrink-0 border border-slate-200 bg-slate-50"
                              loading="lazy"
                              decoding="async"
                            />
                          )}
                          <div className="w-full min-w-0">
                            <span className="text-[10px] text-slate-400 block mb-0.5 truncate">
                              {product.category}
                            </span>
                            <h4 className="font-bold text-slate-900 text-xs sm:text-sm line-clamp-2 leading-snug group-hover:text-emerald-700 transition-colors">
                              {product.name}
                            </h4>
                          </div>
                        </div>

                        <div className="mt-2.5 pt-1.5 border-t border-slate-100 flex flex-col gap-1 w-full">
                          <div className="flex items-center justify-between w-full">
                            <span className="font-black text-emerald-700 text-xs sm:text-sm">
                              {formatCurrency(product.price)}
                            </span>
                            <button
                              type="button"
                              onClick={() => addToCart(product, 'piece')}
                              className="text-[10px] sm:text-[11px] bg-slate-100 hover:bg-emerald-600 hover:text-white text-slate-700 font-bold px-2 py-0.5 rounded-md transition-colors cursor-pointer"
                              title="إضافة بالقطعة للفاتورة"
                            >
                              + قطعة
                            </button>
                          </div>

                          <div className="flex items-center justify-between w-full bg-amber-50/80 border border-amber-200/80 rounded-md px-1.5 py-0.5">
                            <span className="font-bold text-amber-900 text-[10px] sm:text-[11px]">
                              {formatCurrency(dozenPrice)}
                              <span className="text-[9px] text-amber-700 font-normal mr-0.5">/دستة</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => addToCart(product, 'dozen')}
                              className="text-[10px] bg-amber-500 hover:bg-amber-600 text-white font-bold px-1.5 py-0.5 rounded transition-all cursor-pointer shadow-2xs"
                              title="إضافة دستة كاملة بسعر بيع الدستة للفاتورة"
                            >
                              + دستة
                            </button>
                          </div>

                          {/* Owner-only Wholesale Purchase Price (After Retail & Dozen Retail) */}
                          {isOwner && (
                            <div className="flex items-center justify-between w-full bg-amber-100/70 border border-amber-300/80 rounded-md px-1.5 py-0.5 text-[10px]">
                              <span className="font-bold text-amber-900 flex items-center gap-1">
                                <Lock className="w-2.5 h-2.5 text-amber-700 shrink-0" />
                                <span>شراء جملة:</span>
                              </span>
                              <span className="font-black text-amber-950 font-mono">
                                {product.buyWholesale != null ? formatCurrency(product.buyWholesale) : '—'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {filteredProducts.length === 0 && (
                <div className="py-10 px-4 text-center bg-white rounded-2xl border border-slate-200 space-y-3 shadow-2xs">
                  <div className="text-slate-500 text-sm">
                    {searchQuery ? (
                      <span>لم يتم العثور على أي صنف مسجل باسم «<strong className="text-slate-800">{searchQuery}</strong>» في مجموعة «{activeCategory}».</span>
                    ) : (
                      <span>لا توجد أصناف في مجموعة «{activeCategory}».</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickAddName(searchQuery.trim());
                      setQuickAddPrice('');
                      setQuickAddDozenPrice('');
                      setQuickAddCategory(activeCategory !== 'الكل' ? activeCategory : '');
                      setQuickAddQty(1);
                      setQuickAddUnit('piece');
                      setQuickAddSaveToCatalog(false);
                      setQuickAddError('');
                      setIsQuickAddModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-sm cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>إضافة «{searchQuery || 'صنف يدوي'}» للفاتورة يدوياً</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Active Cart Drawer (Grouped by Category) */}
          <div className="lg:col-span-5 xl:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sticky top-28 flex flex-col max-h-[82vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-emerald-600" />
                <h2 className="font-bold text-slate-900 text-base">فاتورة البيع الحالية</h2>
              </div>
              {cart.length > 0 && (
                <button
                  onClick={clearCart}
                  className="text-xs text-rose-600 hover:text-rose-700 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>تفريغ</span>
                </button>
              )}
            </div>

            {/* Optional Customer Name */}
            <div className="pt-3 pb-2">
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                <User className="w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="اسم العميل (اختياري)..."
                  className="bg-transparent text-xs sm:text-sm font-medium w-full outline-none text-slate-800 placeholder-slate-400"
                />
              </div>
            </div>

            {/* Cart Items List: Consecutively Grouped by Category */}
            <div className="flex-1 overflow-y-auto pr-1 my-2 space-y-3">
              {cart.length > 0 ? (
                groupedCart.map(([catName, itemsInCat]) => (
                  <div key={catName} className="space-y-1.5">
                    {/* Category Divider Header in Cart */}
                    <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 bg-slate-100/90 px-2.5 py-1 rounded-lg border border-slate-200/60">
                      <div className="flex items-center gap-1.5">
                        <Folder className="w-3 h-3 text-emerald-600" />
                        <span>{catName}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-semibold">
                        {itemsInCat.reduce((sum, it) => sum + it.quantity, 0)} قطعة
                      </span>
                    </div>

                    <div className="divide-y divide-slate-100 pr-1">
                      {itemsInCat.map((item) => {
                        const origPrice = item.originalPrice ?? item.price;
                        const isPriceModified = Math.abs(item.price - origPrice) > 0.001;
                        const draftPriceVal = priceDrafts[item.id] ?? String(item.price);

                        return (
                          <div key={item.id} className="py-2.5 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-xs text-slate-900 truncate">
                                    {item.name}
                                  </span>
                                  {!item.productId && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200">
                                      يدوي
                                    </span>
                                  )}
                                  {/* Unit toggle button */}
                                  <button
                                    type="button"
                                    onClick={() => toggleItemUnit(item.id)}
                                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                                      item.unit === 'dozen'
                                        ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
                                        : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                                    }`}
                                    title="اضغط للتبديل بين البيع بالقطعة أو البيع بالدستة"
                                  >
                                    {item.unit === 'dozen' ? '📦 دستة' : 'قطعة'}
                                  </button>
                                </div>
                              </div>

                              {/* Quantity Stepper Controls */}
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => updateQuantity(item.id, -1)}
                                  className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
                                  title="إنقاص الكمية"
                                  aria-label={`إنقاص كمية ${item.name}`}
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <input
                                  type="number"
                                  min="1"
                                  value={item.quantity}
                                  onFocus={(e) => e.target.select()}
                                  onChange={(e) => setDirectQuantity(item.id, e.target.value)}
                                  aria-label={`كمية ${item.name}`}
                                  className="w-9 text-center text-xs font-bold border border-slate-200 rounded py-0.5"
                                />
                                <button
                                  type="button"
                                  onClick={() => updateQuantity(item.id, 1)}
                                  className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
                                  title="زيادة الكمية"
                                  aria-label={`زيادة كمية ${item.name}`}
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeFromCart(item.id)}
                                  className="text-slate-400 hover:text-rose-500 p-1 mr-0.5 cursor-pointer"
                                  title="حذف الصنف"
                                  aria-label={`حذف ${item.name}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Per-Invoice Unit Price Adjustment Row (Does NOT modify catalog price) */}
                            <div className="flex items-center justify-between gap-2 flex-wrap bg-slate-50/90 border border-slate-200/80 rounded-lg px-2 py-1">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-semibold text-slate-500">السعر:</span>
                                <button
                                  type="button"
                                  onClick={() => handleAdjustItemPrice(item.id, -1)}
                                  className="w-5 h-5 rounded bg-white border border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
                                  title="تخفيض السعر 1 ج.م لهذه الفاتورة فقط"
                                  aria-label={`تخفيض سعر ${item.name}`}
                                >
                                  <Minus className="w-2.5 h-2.5" />
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.25"
                                  value={draftPriceVal}
                                  onFocus={(e) => e.target.select()}
                                  onChange={(e) => handlePriceInputChange(item.id, e.target.value)}
                                  onBlur={() => handlePriceInputCommit(item.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      handlePriceInputCommit(item.id);
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  aria-label={`سعر ${item.name}`}
                                  title="تعديل سعر البيع لهذه الفاتورة فقط بدون تغيير السعر الأصلي للصنف"
                                  className={`w-14 text-center text-[11px] font-black font-mono border rounded py-0.5 outline-none transition-colors ${
                                    isPriceModified
                                      ? 'bg-amber-50 border-amber-400 text-amber-900'
                                      : 'bg-white border-slate-200 text-slate-800 focus:border-emerald-500'
                                  }`}
                                />
                                <button
                                  type="button"
                                  onClick={() => handleAdjustItemPrice(item.id, 1)}
                                  className="w-5 h-5 rounded bg-white border border-slate-200 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
                                  title="زيادة السعر 1 ج.م لهذه الفاتورة فقط"
                                  aria-label={`زيادة سعر ${item.name}`}
                                >
                                  <Plus className="w-2.5 h-2.5" />
                                </button>
                                <span className="text-[10px] text-slate-500">ج.م</span>
                              </div>

                              <div className="text-[11px] font-black text-emerald-700 font-mono">
                                = {formatCurrency(item.price * item.quantity)}
                              </div>
                            </div>

                            {isPriceModified && (
                              <div className="flex items-center justify-between gap-2 text-[10px] bg-amber-50 border border-amber-200 text-amber-900 rounded-md px-2 py-0.5">
                                <span>
                                  سعر الفاتورة فقط (الأصل: <strong className="font-mono">{formatCurrency(origPrice)}</strong>)
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleResetItemPrice(item.id)}
                                  className="inline-flex items-center gap-0.5 font-bold text-amber-900 hover:text-amber-700 underline cursor-pointer"
                                  title="استعادة السعر الأصلي للصنف"
                                >
                                  <RotateCcw className="w-2.5 h-2.5" />
                                  <span>استعادة</span>
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-14 text-center text-slate-400 text-xs">
                  السلة فارغة حالياً.<br />اضغط على أي صنف من قائمة الأصناف لإضافته للفاتورة.
                </div>
              )}
            </div>

            {/* Cart Summary & Action */}
            <div className="pt-3 border-t border-slate-100 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">إجمالي الأصناف:</span>
                <span className="font-bold text-xs text-slate-800">
                  {cart.reduce((sum, item) => sum + item.quantity, 0)} قطعة
                </span>
              </div>
              <div className="flex items-center justify-between text-base">
                <span className="font-bold text-slate-900">المبلغ الإجمالي:</span>
                <span className="font-black text-emerald-600 text-lg">
                  {formatCurrency(cartTotal)}
                </span>
              </div>

              <button
                onClick={handleSaveInvoice}
                disabled={cart.length === 0}
                className={`w-full py-3 rounded-xl font-bold text-sm text-white shadow-md flex items-center justify-center gap-2 transition-all ${
                  cart.length > 0
                    ? 'bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]'
                    : 'bg-slate-300 cursor-not-allowed'
                }`}
              >
                <Check className="w-4 h-4" />
                <span>{editingInvoiceId ? 'حفظ تعديلات الفاتورة' : 'إتمام وحفظ الفاتورة'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Invoice History Section */
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-base text-slate-900">سجل الفواتير الصادرة</h2>
              <p className="text-xs text-slate-500">
                يمكنك معاينة أي فاتورة سابقة، طباعتها، إرسالها على واتساب للعميل، أو تعديلها
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="ابحث برقم الفاتورة أو العميل..."
                className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-lg py-2 px-3 text-xs outline-none"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {filteredInvoices.map((inv) => (
              <div
                key={inv.id}
                className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-50/70 px-2 rounded-lg transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm text-slate-900">
                      فاتورة #{inv.id}
                    </span>
                    {inv.customer && (
                      <span className="text-xs bg-slate-100 text-slate-700 font-semibold px-2 py-0.5 rounded">
                        {inv.customer}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                    <span>{formatDateTime(inv.date)}</span>
                    <span>·</span>
                    <span>{inv.items.length} أصناف ({inv.items.reduce((s, i) => s + i.quantity, 0)} قطعة)</span>
                  </div>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-3">
                  <span className="font-black text-emerald-600 text-sm">
                    {formatCurrency(inv.total)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setSelectedInvoice(inv)}
                      className="text-xs bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold px-3 py-1.5 rounded-lg transition-colors"
                    >
                      معاينة / طباعة
                    </button>
                    <button
                      onClick={() => handleEditPastInvoice(inv)}
                      className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                      title={isOwner ? "تعديل الفاتورة" : "تعديل الفاتورة (خاص بالمالك)"}
                    >
                      {!isOwner && <Lock className="w-3 h-3 text-amber-600" />}
                      <span>تعديل</span>
                    </button>
                    <button
                      onClick={() => {
                        if (!isOwner) {
                          soundFx.playWarning();
                          onRequestOwnerLogin?.();
                          return;
                        }
                        soundFx.playWarning();
                        setPendingDeleteInvoice(inv);
                      }}
                      className="text-xs text-rose-600 hover:bg-rose-50 p-1.5 rounded-lg transition-colors cursor-pointer"
                      title={isOwner ? "حذف الفاتورة" : "حذف الفاتورة (خاص بمالك المتجر فقط)"}
                    >
                      {isOwner ? <Trash2 className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5 text-slate-400" />}
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {filteredInvoices.length === 0 && (
              <div className="py-12 text-center text-slate-400 text-sm">
                لا توجد فواتير مطابقة لبحثك.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Ultra-Professional Printable A4 Invoice Sheet (Full Page, Zero Bleed, Responsive Typography) */}
      {selectedInvoice && (() => {
        const itemCount = selectedInvoice.items.length;
        const isFew = itemCount <= 3;
        const isModerate = itemCount > 3 && itemCount <= 8;
        const isMany = itemCount > 8;

        return (
          <div
            id="printable-invoice-a4-sheet"
            className={`font-sans text-slate-900 bg-white border-t-4 border-emerald-700 ${
              isFew ? 'p-8' : isModerate ? 'p-6' : 'p-4'
            }`}
          >
            {/* Store & Invoice Header (Vibrant Emerald & Gold Brand Palette) */}
            <div className={`flex justify-between items-start rounded-2xl border border-emerald-200 border-b-4 border-b-emerald-700 bg-gradient-to-l from-emerald-50 via-teal-50/70 to-amber-50/40 ${
              isFew ? 'p-6 mb-7' : isModerate ? 'p-4 mb-5' : 'p-3 mb-3'
            }`}>
              <div className="space-y-1.5">
                <div className={`font-black text-emerald-950 tracking-tight ${
                  isFew ? 'text-4xl' : isModerate ? 'text-3xl' : 'text-2xl'
                }`}>
                  {db.settings.shop || 'مكتبة الطيب أحسن'}
                </div>
                <div className={`font-bold text-teal-800 ${
                  isFew ? 'text-base' : isModerate ? 'text-sm' : 'text-xs'
                }`}>
                  {db.settings.tagline || 'للأدوات المكتبية والمدرسية والخدمات الطلابية'}
                </div>
                {db.settings.phone && (
                  <div className={`inline-flex items-center gap-1.5 font-bold text-emerald-900 bg-white/90 border border-emerald-200 rounded-lg px-2.5 py-1 ${
                    isFew ? 'text-sm' : 'text-xs'
                  }`}>
                    <span>هاتف / واتساب:</span>
                    <span className="font-mono text-emerald-950">{db.settings.phone}</span>
                  </div>
                )}
              </div>

              <div className="text-left space-y-1.5">
                <div className={`inline-block font-black text-white bg-emerald-800 border-b-4 border-amber-400 rounded-xl shadow-xs ${
                  isFew ? 'px-6 py-2.5 text-2xl' : isModerate ? 'px-4 py-1.5 text-xl' : 'px-3 py-1 text-base'
                }`}>
                  فاتورة مبيعات
                </div>
                <div>
                  <span className={`inline-block font-mono font-black text-amber-950 bg-amber-100 border border-amber-300 rounded-lg px-2.5 py-0.5 ${
                    isFew ? 'text-base' : isModerate ? 'text-sm' : 'text-xs'
                  }`}>
                    رقم الفاتورة: #{selectedInvoice.id}
                  </span>
                </div>
                <div className={`font-mono font-semibold text-slate-600 ${
                  isFew ? 'text-sm' : 'text-[11px]'
                }`}>
                  {formatDateTime(selectedInvoice.date)}
                </div>
              </div>
            </div>

            {/* Metadata Box */}
            <div className={`grid grid-cols-2 gap-4 rounded-xl border border-emerald-200 bg-gradient-to-r from-slate-50 to-emerald-50/50 ${
              isFew ? 'p-5 mb-7 text-base' : isModerate ? 'p-3.5 mb-5 text-sm' : 'p-2.5 mb-3 text-xs'
            }`}>
              <div className="space-y-1.5">
                <div>
                  <span className="text-teal-800 font-bold">العميل: </span>
                  <strong className="text-slate-900">{selectedInvoice.customer || 'عميل نقدي كرام'}</strong>
                </div>
                <div>
                  <span className="text-teal-800 font-bold">طريقة الدفع: </span>
                  <strong className="inline-block bg-emerald-100 text-emerald-900 border border-emerald-300 px-2 py-0.5 rounded text-xs">نقداً (Cash)</strong>
                </div>
              </div>
              <div className="text-left space-y-1.5">
                <div>
                  <span className="text-teal-800 font-bold">تاريخ الفاتورة: </span>
                  <strong className="font-mono text-slate-900">{formatDateTime(selectedInvoice.date)}</strong>
                </div>
                <div>
                  <span className="text-teal-800 font-bold">إجمالي الأصناف: </span>
                  <strong className="text-emerald-950">{selectedInvoice.items.length} صنف ({selectedInvoice.items.reduce((s, i) => s + i.quantity, 0)} قطعة)</strong>
                </div>
              </div>
            </div>

            {/* Table of Items */}
            <table className="w-full text-right border-collapse print-table">
              <thead>
                <tr className={`bg-emerald-800 font-bold text-white ${
                  isFew ? 'text-base' : isModerate ? 'text-sm' : 'text-xs'
                }`}>
                  <th className={`w-12 text-center ${isFew ? 'py-3 px-3' : isModerate ? 'py-2 px-2' : 'py-1.5 px-2'}`}>#</th>
                  <th className={`${isFew ? 'py-3 px-4' : isModerate ? 'py-2 px-3' : 'py-1.5 px-2'}`}>اسم الصنف والمواصفات</th>
                  <th className={`w-28 text-center ${isFew ? 'py-3 px-3' : isModerate ? 'py-2 px-2' : 'py-1.5 px-2'}`}>سعر الوحدة</th>
                  <th className={`w-24 text-center ${isFew ? 'py-3 px-3' : isModerate ? 'py-2 px-2' : 'py-1.5 px-2'}`}>الكمية</th>
                  <th className={`w-32 text-left ${isFew ? 'py-3 px-4' : isModerate ? 'py-2 px-3' : 'py-1.5 px-2'}`}>الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {selectedInvoice.items.map((item, idx) => (
                  <tr key={idx} className={idx % 2 === 1 ? 'bg-emerald-50/40' : 'bg-white'}>
                    <td className={`text-center font-mono font-bold text-emerald-800 ${
                      isFew ? 'py-4 px-3 text-base' : isModerate ? 'py-2.5 px-2 text-sm' : 'py-1.5 px-2 text-xs'
                    }`}>
                      {idx + 1}
                    </td>
                    <td className={`font-bold text-slate-900 ${
                      isFew ? 'py-4 px-4 text-lg' : isModerate ? 'py-2.5 px-3 text-sm' : 'py-1.5 px-2 text-xs'
                    }`}>
                      {item.name}
                      {item.unit === 'dozen' && (
                        <span className="inline-block bg-amber-100 text-amber-900 border border-amber-300 font-bold mr-1.5 px-1.5 py-0.5 rounded text-[11px]">دستة</span>
                      )}
                    </td>
                    <td className={`text-center font-mono font-semibold text-slate-700 ${
                      isFew ? 'py-4 px-3 text-base' : isModerate ? 'py-2.5 px-2 text-sm' : 'py-1.5 px-2 text-xs'
                    }`}>
                      {formatCurrency(item.price)}
                    </td>
                    <td className={`text-center font-black font-mono text-teal-900 ${
                      isFew ? 'py-4 px-3 text-lg' : isModerate ? 'py-2.5 px-2 text-sm' : 'py-1.5 px-2 text-xs'
                    }`}>
                      {item.quantity} {item.unit === 'dozen' ? 'دستة' : 'قطعة'}
                    </td>
                    <td className={`text-left font-black font-mono text-emerald-900 ${
                      isFew ? 'py-4 px-4 text-xl' : isModerate ? 'py-2.5 px-3 text-sm' : 'py-1.5 px-2 text-xs'
                    }`}>
                      {formatCurrency(item.price * item.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Total Box */}
            <div className={`flex justify-end ${
              isFew ? 'mt-9' : isModerate ? 'mt-6' : 'mt-4'
            }`}>
              <div className={`border-2 border-emerald-800 border-b-4 border-b-amber-400 rounded-2xl bg-gradient-to-l from-emerald-900 via-emerald-950 to-slate-900 text-white shadow-sm ${
                isFew ? 'p-6 w-96' : isModerate ? 'p-4 w-80' : 'p-3 w-72'
              }`}>
                <div className="flex justify-between items-center text-emerald-200 text-xs pb-1.5 mb-2 border-b border-emerald-700/60">
                  <span>إجمالي القطع المباعة:</span>
                  <span className="font-mono font-bold text-white">{selectedInvoice.items.reduce((s, i) => s + i.quantity, 0)} قطعة</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className={`font-bold text-white ${isFew ? 'text-xl' : isModerate ? 'text-base' : 'text-sm'}`}>
                    المبلغ الإجمالي:
                  </span>
                  <span className={`font-black font-mono text-amber-300 ${
                    isFew ? 'text-4xl' : isModerate ? 'text-2xl' : 'text-xl'
                  }`}>
                    {formatCurrency(selectedInvoice.total)}
                  </span>
                </div>
              </div>
            </div>

            {/* Polite Clean Footer (NO return clause, NO barcode number) */}
            <div className={`text-center border-t-2 border-emerald-200 text-emerald-950 font-bold bg-emerald-50/40 rounded-b-xl ${
              isFew ? 'mt-12 py-5 text-base' : isModerate ? 'mt-7 py-3.5 text-sm' : 'mt-4 py-2.5 text-xs'
            }`}>
              شكراً لتعاملكم معنا ونسعد بزيارتكم دائماً ❤️
            </div>
          </div>
        );
      })()}

      {/* Invoice Modal Preview Dialog */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-4 my-8">
            {/* Modal Header */}
            <div className="flex items-center justify-between no-print border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-600" />
                <span>معاينة وطباعة الفاتورة #{selectedInvoice.id}</span>
              </h3>
              <button
                onClick={() => {
                  soundFx.pop();
                  setSelectedInvoice(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
                aria-label="إغلاق المعاينة"
                title="إغلاق"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Printable Professional Receipt Container (Used for 80mm Thermal Print & On-Screen Preview) */}
            <div
              id="printable-receipt-area"
              className="printable-receipt bg-white border border-emerald-200 border-t-4 border-t-emerald-700 rounded-xl p-4 sm:p-5 text-slate-900 space-y-3 font-sans text-xs shadow-sm max-h-[60vh] overflow-y-auto"
            >
              {/* Executive Header */}
              <div className="text-center space-y-1.5 pb-3 border-b-2 border-emerald-700 bg-gradient-to-b from-emerald-50 via-teal-50/40 to-white -mx-4 -mt-4 px-4 pt-4 rounded-t-lg">
                <div className="inline-block bg-emerald-800 text-white text-[10px] font-black px-3 py-0.5 rounded-full border-b-2 border-amber-400">
                  فاتورة مبيعات
                </div>
                <div className="text-lg font-black tracking-tight text-emerald-950">
                  {db.settings.shop || 'مكتبة الطيب أحسن'}
                </div>
                <div className="text-[11px] text-teal-800 font-semibold">
                  {db.settings.tagline || 'للأدوات المكتبية والمدرسية والخدمات الطلابية'}
                </div>
                {db.settings.phone && (
                  <div className="text-xs font-mono font-bold text-emerald-900">
                    واتساب / تليفون: {db.settings.phone}
                  </div>
                )}
              </div>

              {/* Invoice Meta Grid */}
              <div className="bg-gradient-to-r from-emerald-50/80 to-amber-50/50 border border-emerald-200 rounded-lg p-2.5 grid grid-cols-2 gap-1.5 text-[11px]">
                <div>
                  <span className="text-teal-800 font-semibold">رقم الفاتورة:</span>{' '}
                  <strong className="font-mono font-black text-amber-900 bg-amber-100 px-1.5 py-0.5 rounded">#{selectedInvoice.id}</strong>
                </div>
                <div className="text-left font-mono">
                  <span className="text-teal-800 font-semibold">التاريخ:</span>{' '}
                  <strong className="text-slate-900">{formatDateTime(selectedInvoice.date)}</strong>
                </div>
                <div>
                  <span className="text-teal-800 font-semibold">العميل:</span>{' '}
                  <strong className="text-slate-900">{selectedInvoice.customer || 'عميل نقدي'}</strong>
                </div>
                <div className="text-left">
                  <span className="text-teal-800 font-semibold">طريقة الدفع:</span>{' '}
                  <strong className="text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded">نقدي (Cash)</strong>
                </div>
              </div>

              {/* Itemized Table */}
              <div className="space-y-3 pt-1">
                {groupedReceiptItems.map(([catName, itemsInCat]) => (
                  <div key={catName} className="space-y-1">
                    <div className="text-[10px] font-bold text-teal-950 bg-teal-50 border-r-4 border-emerald-600 px-2 py-1 rounded-sm flex items-center justify-between">
                      <span>📁 {catName}</span>
                      <span className="text-emerald-800">({itemsInCat.reduce((s, i) => s + i.quantity, 0)} قطعة)</span>
                    </div>
                    <table className="w-full text-right text-[11px] border-collapse overflow-hidden rounded-md">
                      <thead>
                        <tr className="bg-emerald-800 font-bold text-white">
                          <th className="py-1.5 px-1.5">الصنف</th>
                          <th className="py-1.5 px-1 text-center w-14">السعر</th>
                          <th className="py-1.5 px-1 text-center w-12">العدد</th>
                          <th className="py-1.5 px-1.5 text-left w-16">الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-emerald-100">
                        {itemsInCat.map((item, idx) => (
                          <tr key={idx} className={idx % 2 === 1 ? 'bg-emerald-50/40' : 'bg-white'}>
                            <td className="py-1.5 px-1.5 font-bold text-slate-900">
                              {item.name}
                              {item.unit === 'dozen' && (
                                <span className="text-[10px] bg-amber-100 text-amber-900 border border-amber-300 mr-1 px-1 rounded font-semibold">
                                  دستة
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 px-1 text-center text-slate-700 font-mono">{formatCurrency(item.price)}</td>
                            <td className="py-1.5 px-1 text-center font-bold text-teal-900 font-mono">
                              {item.quantity} {item.unit === 'dozen' ? 'د' : 'ق'}
                            </td>
                            <td className="py-1.5 px-1.5 text-left font-black text-emerald-900 font-mono">{formatCurrency(item.price * item.quantity)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>

              {/* Professional Receipt Totals Box */}
              <div className="pt-2 border-t-2 border-emerald-700 space-y-1.5">
                <div className="flex justify-between items-center text-xs text-slate-600">
                  <span>إجمالي الأصناف والقطع:</span>
                  <span className="font-bold font-mono text-emerald-950">
                    {selectedInvoice.items.length} أصناف ({selectedInvoice.items.reduce((s, i) => s + i.quantity, 0)} قطعة)
                  </span>
                </div>
                <div className="bg-gradient-to-l from-emerald-900 via-emerald-950 to-slate-900 text-white border-b-4 border-amber-400 p-2.5 rounded-lg flex justify-between items-center font-black text-sm sm:text-base shadow-xs">
                  <span>المبلغ المطلوب سداده:</span>
                  <span className="text-amber-300 font-mono">{formatCurrency(selectedInvoice.total)}</span>
                </div>
              </div>

              {/* Legal & Welcome Footer - Clean without 14 days return or barcode */}
              <div className="text-center pt-2 border-t border-dashed border-emerald-300 text-[11px] text-emerald-950 font-bold">
                شكراً لتعاملكم معنا ونسعد بزيارتكم دائماً ❤️
              </div>
            </div>

            {/* Modal Actions */}
            <div className="no-print space-y-2.5 pt-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    soundFx.cash();
                    document.body.classList.remove('print-receipt-mode');
                    document.body.classList.add('print-invoice-a4');
                    window.print();
                    setTimeout(() => {
                      document.body.classList.remove('print-invoice-a4');
                    }, 1000);
                  }}
                  className="bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-3 rounded-xl flex items-center justify-center gap-1.5 text-xs shadow-md transition-colors cursor-pointer border border-slate-700"
                >
                  <Printer className="w-4 h-4 text-emerald-400" />
                  <span>طباعة صفحة كاملة (A4)</span>
                </button>

                <button
                  onClick={() => {
                    soundFx.cash();
                    document.body.classList.remove('print-invoice-a4');
                    document.body.classList.add('print-receipt-mode');
                    window.print();
                    setTimeout(() => {
                      document.body.classList.remove('print-receipt-mode');
                    }, 1000);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-3 rounded-xl flex items-center justify-center gap-1.5 text-xs shadow transition-colors cursor-pointer"
                >
                  <Receipt className="w-4 h-4" />
                  <span>طابعة حرارية (80mm)</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(
                    generateInvoiceWhatsAppText(selectedInvoice, db.settings.shop, db.settings.phone)
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => soundFx.pop()}
                  className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>إرسال واتساب</span>
                </a>

                <button
                  onClick={() => {
                    soundFx.pop();
                    const txt = generateInvoiceWhatsAppText(selectedInvoice, db.settings.shop, db.settings.phone);
                    navigator.clipboard.writeText(txt);
                    setCopiedNotification(true);
                    setTimeout(() => setCopiedNotification(false), 2000);
                  }}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedNotification ? 'تم النسخ!' : 'نسخ الفاتورة'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Add Manual / Optional Catalog Product Modal */}
      {isQuickAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150 my-4">
            <div className="bg-gradient-to-r from-emerald-600 to-teal-700 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PackagePlus className="w-5 h-5" />
                <h3 className="font-bold text-sm sm:text-base">إضافة صنف يدوي وتسعيره للفاتورة</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsQuickAddModalOpen(false)}
                className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setQuickAddError('');

                const res = buildQuickAddInvoiceResult({
                  name: quickAddName,
                  piecePriceStr: quickAddPrice,
                  dozenPriceStr: quickAddDozenPrice,
                  category: quickAddCategory,
                  quantity: quickAddQty,
                  unit: quickAddUnit,
                  saveToCatalog: quickAddSaveToCatalog,
                  existingProducts: db.products,
                });

                if (res.ok === false) {
                  setQuickAddError(res.error);
                  return;
                }

                // Register permanently ONLY if user explicitly confirmed saveToCatalog
                if (res.productToRegister) {
                  onAddProduct?.(res.productToRegister);
                }

                const nextCartItem = res.cartItem;
                setCart((prev) => {
                  const existing = prev.find((item) => item.id === nextCartItem.id);
                  if (existing) {
                    return prev.map((item) =>
                      item.id === nextCartItem.id
                        ? { ...item, quantity: item.quantity + nextCartItem.quantity }
                        : item
                    );
                  }
                  return [...prev, nextCartItem];
                });

                soundFx.playSuccess();
                setIsQuickAddModalOpen(false);
                setSearchQuery('');
                setQuickAddError('');
                setQuickAddPrice('');
                setQuickAddDozenPrice('');
                setQuickAddUnit('piece');
                setQuickAddSaveToCatalog(false);
              }}
              className="p-5 space-y-4"
            >
              {quickAddError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-xl text-xs font-bold">
                  ⚠️ {quickAddError}
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">اسم الصنف *</label>
                <input
                  type="text"
                  required
                  value={quickAddName}
                  onChange={(e) => setQuickAddName(e.target.value)}
                  placeholder="مثال: قلم جل أزرق 0.7، كشكول سلك 100ق..."
                  className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:bg-white rounded-xl py-2 px-3 text-sm font-semibold outline-none"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    سعر بيع القطعة يدوياً (ج.م) {quickAddUnit === 'piece' ? '*' : ''}
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    required={quickAddUnit === 'piece'}
                    value={quickAddPrice}
                    onChange={(e) => setQuickAddPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:bg-white rounded-xl py-2 px-3 text-sm font-bold text-emerald-600 outline-none text-left font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    سعر بيع الدستة يدوياً {quickAddUnit === 'dozen' ? '*' : '(اختياري)'}
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    required={quickAddUnit === 'dozen' && !quickAddPrice.trim()}
                    value={quickAddDozenPrice}
                    onChange={(e) => setQuickAddDozenPrice(e.target.value)}
                    placeholder={quickAddPrice ? String(parseFloat(quickAddPrice) * 12) : '0.00'}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-amber-500 focus:bg-white rounded-xl py-2 px-3 text-sm font-bold text-amber-700 outline-none text-left font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">وحدة البيع للفاتورة</label>
                  <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                    <button
                      type="button"
                      onClick={() => setQuickAddUnit('piece')}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                        quickAddUnit === 'piece' ? 'bg-white text-emerald-700 shadow-2xs' : 'text-slate-600'
                      }`}
                    >
                      بالقطعة
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickAddUnit('dozen')}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                        quickAddUnit === 'dozen' ? 'bg-amber-500 text-white shadow-2xs' : 'text-slate-600'
                      }`}
                    >
                      بالدستة
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    الكمية ({quickAddUnit === 'dozen' ? 'دستة' : 'قطعة'})
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={quickAddQty}
                    onChange={(e) => setQuickAddQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:bg-white rounded-xl py-2 px-3 text-sm font-bold outline-none text-center font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">المجموعة / التصنيف (اختياري)</label>
                <input
                  type="text"
                  list="pos-quickadd-categories"
                  value={quickAddCategory}
                  onChange={(e) => setQuickAddCategory(e.target.value)}
                  placeholder="أصناف يدوية أو اختر مجموعة..."
                  className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:bg-white rounded-xl py-2 px-3 text-sm outline-none"
                />
                <datalist id="pos-quickadd-categories">
                  {categories.filter(c => c !== 'الكل').map(cat => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>

              {/* Explicit Confirmation Opt-In Toggle to Register in Store Catalog */}
              <label
                className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                  quickAddSaveToCatalog
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                    : 'bg-sky-50/70 border-sky-200 text-slate-800'
                }`}
              >
                <input
                  type="checkbox"
                  checked={quickAddSaveToCatalog}
                  onChange={(e) => setQuickAddSaveToCatalog(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-emerald-600 cursor-pointer shrink-0"
                />
                <div className="text-xs leading-relaxed">
                  <div className="font-black">
                    تأكيد تسجيل هذا الصنف دائماً في قائمة الأصناف السحابية
                  </div>
                  <div className="text-[11px] opacity-80 mt-0.5">
                    {quickAddSaveToCatalog
                      ? 'سيُحفظ هذا الصنف في قائمة الأصناف السحابية ليظهر على كل الأجهزة مستقبلاً.'
                      : 'غير مُفعل: سيُضاف الصنف لهذه الفاتورة فقط بسعره اليدوي ولن يُسجّل ضمن أصناف المتجر.'}
                  </div>
                </div>
              </label>

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsQuickAddModalOpen(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl text-xs transition-colors shadow-sm cursor-pointer"
                >
                  {quickAddSaveToCatalog ? 'تأكيد التسجيل والإضافة للفاتورة' : 'إضافة للفاتورة فقط'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Empty Cart */}
      <ConfirmModal
        isOpen={confirmClearCartOpen}
        title="إفراغ سلة الفاتورة"
        description="هل تريد مسح جميع الأصناف من الفاتورة الحالية؟"
        confirmLabel="نعم، إفراغ السلة"
        isDestructive={true}
        onConfirm={confirmClearCart}
        onCancel={() => setConfirmClearCartOpen(false)}
      />

      {/* Confirm Delete Past Invoice (Soft-delete to 30-day Trash Bin) */}
      <ConfirmModal
        isOpen={Boolean(pendingDeleteInvoice)}
        title={`حذف الفاتورة #${pendingDeleteInvoice?.id || ''}`}
        description="هل أنت متأكد من حذف هذه الفاتورة؟ ستُحفظ داخل سلة المهملات لمدة 30 يوماً لإمكانية استرجاعها قبل الحذف النهائي."
        confirmLabel="نعم، حذف الفاتورة"
        isDestructive={true}
        itemDetails={
          pendingDeleteInvoice
            ? [
                { label: 'رقم الفاتورة', value: `#${pendingDeleteInvoice.id}` },
                { label: 'العميل', value: pendingDeleteInvoice.customer || 'عميل نقدي' },
                { label: 'الإجمالي', value: formatCurrency(pendingDeleteInvoice.total) },
              ]
            : undefined
        }
        onConfirm={() => {
          if (pendingDeleteInvoice) {
            soundFx.playRemove();
            onDeleteInvoice(pendingDeleteInvoice.id);
            setPendingDeleteInvoice(null);
          }
        }}
        onCancel={() => setPendingDeleteInvoice(null)}
      />
    </div>
  );
};
