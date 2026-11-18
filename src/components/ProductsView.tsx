import React, { useState, useMemo, useRef, useDeferredValue, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  Eye, 
  EyeOff, 
  Edit3, 
  Trash2, 
  FolderPlus, 
  Folder, 
  ArrowRight, 
  Image as ImageIcon, 
  AlertCircle, 
  Check, 
  X,
  Package,
  Layers,
  ClipboardList,
  Sparkles,
  Camera,
  Upload,
  ZoomIn,
  Lock,
  KeyRound,
  ShieldCheck,
  CalendarClock
} from 'lucide-react';
import { AppDatabase, Product } from '../types';
import {
  formatCurrency,
  formatProductAddedDate,
  isDuplicateProduct,
  matchesNormalizedTokens,
  normalizeArabicSearchText,
  normalizeArabicText,
  ProductSortField,
  sortProducts,
  tokenizeArabicSearch,
} from '../utils/shopLogic';
import { compressImage } from '../data/storage';
import { soundFx } from '../utils/audioFeedback';
import { ImageModal } from './ImageModal';
import { ProductSortBar, useProductSort } from './ProductSortBar';
import { ConfirmModal } from './ConfirmModal';

interface ProductsViewProps {
  db: AppDatabase;
  onSaveProduct: (product: Product) => void;
  onDeleteProduct: (productId: string) => void;
  onAddToShortage: (product: Product) => { added: boolean; message: string } | void;
  onRenameCategory: (oldName: string, newName: string) => void;
  onDeleteCategory: (categoryName: string) => void;
  isOwner?: boolean;
  onRequestOwnerLogin?: () => void;
}

export const ProductsView: React.FC<ProductsViewProps> = ({
  db,
  onSaveProduct,
  onDeleteProduct,
  onAddToShortage,
  onRenameCategory,
  onDeleteCategory,
  isOwner = false,
  onRequestOwnerLogin
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [showWholesalePrices, setShowWholesalePrices] = useState<boolean>(isOwner);

  useEffect(() => {
    setShowWholesalePrices(isOwner);
  }, [isOwner]);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Form State
  const [formName, setFormName] = useState<string>('');
  const [formCategory, setFormCategory] = useState<string>('');
  const [formPrice, setFormPrice] = useState<string>('');
  const [formBuyWholesale, setFormBuyWholesale] = useState<string>('');
  const [formSellDozen, setFormSellDozen] = useState<string>('');
  const [formImage, setFormImage] = useState<string>('');
  const [isProcessingImage, setIsProcessingImage] = useState<boolean>(false);
  const [zoomedProduct, setZoomedProduct] = useState<{ url: string; title: string; category?: string; price?: number } | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'warning' } | null>(null);
  const [formError, setFormError] = useState<string>('');
  const [categoryModal, setCategoryModal] = useState<{ mode: 'create' | 'rename'; oldName?: string } | null>(null);
  const [categoryInput, setCategoryInput] = useState<string>('');
  const [categoryModalError, setCategoryModalError] = useState<string>('');
  const [pendingDeleteProduct, setPendingDeleteProduct] = useState<Product | null>(null);
  const [pendingDeleteCategory, setPendingDeleteCategory] = useState<string | null>(null);
  const { sortField, sortDirection, selectSortField, toggleDirection } = useProductSort();

  const handleSelectSortField = (field: ProductSortField) => {
    selectSortField(field);
    if (selectedCategory === null && !searchQuery.trim()) {
      setSelectedCategory('ALL_ITEMS');
    }
  };

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

  // Unique categories list with count
  const categoriesWithCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of indexedProducts) {
      counts[item.cleanCategory] = (counts[item.cleanCategory] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0], 'ar'));
  }, [indexedProducts]);

  // O(1) lookup set for shortages
  const shortageNamesSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of db.shortages) {
      set.add(normalizeArabicText(s.name));
    }
    return set;
  }, [db.shortages]);

  const isAlreadyInShortages = (productName: string) => {
    return shortageNamesSet.has(normalizeArabicText(productName));
  };

  // Toast feedback helper
  const showToast = (toastObj: { text: string; type: 'success' | 'warning' } | string) => {
    if (typeof toastObj === 'string') {
      setToast({ text: toastObj, type: 'success' });
    } else {
      setToast(toastObj);
    }
    setTimeout(() => setToast(null), 3500);
  };

  // Handle adding product to shortages with duplicate check and feedback
  const handleAddProductToShortage = (product: Product) => {
    if (isAlreadyInShortages(product.name)) {
      showToast({ 
        text: `⚠️ هذا الصنف «${product.name}» مضاف بالفعل إلى قائمة النواقص!`, 
        type: 'warning' 
      });
      return;
    }

    const result = onAddToShortage(product);
    if (result && !result.added) {
      showToast({ 
        text: result.message || `⚠️ هذا الصنف مضاف بالفعل إلى قائمة النواقص!`, 
        type: 'warning' 
      });
    } else {
      showToast({ 
        text: `✓ تمت إضافة «${product.name}» إلى قائمة النواقص وحفظها بنجاح`, 
        type: 'success' 
      });
    }
  };

  // Filtered products list (already sorted alphabetically in indexedProducts!)
  const isSearchingAll = deferredSearchQuery.trim().length > 0;

  const displayProducts = useMemo(() => {
    const tokens = tokenizeArabicSearch(deferredSearchQuery);
    if (tokens.length > 0) {
      return indexedProducts
        .filter((item) => matchesNormalizedTokens(tokens, item.normName, item.normCat))
        .map((item) => item.product);
    }
    if (selectedCategory === 'ALL_ITEMS') {
      return indexedProducts.map((item) => item.product);
    }
    if (selectedCategory !== null) {
      return indexedProducts
        .filter((item) => item.cleanCategory === selectedCategory)
        .map((item) => item.product);
    }
    return [];
  }, [indexedProducts, selectedCategory, deferredSearchQuery]);

  // Duplicate product check inside modal
  const duplicateFound = useMemo(() => {
    if (!formName.trim()) return false;
    return isDuplicateProduct(formName, editingProduct ? editingProduct.id : null, db.products);
  }, [formName, editingProduct, db.products]);

  // Real-time suggestions of existing registered items as user types (supports out-of-order multi-word queries)
  const matchingSuggestions = useMemo(() => {
    const trimmed = formName.trim();
    if (trimmed.length < 2) return [];
    const normInput = normalizeArabicSearchText(trimmed);
    const tokens = tokenizeArabicSearch(trimmed);

    return indexedProducts
      .filter(({ product, normName }) => {
        if (editingProduct && product.id === editingProduct.id) return false;
        return matchesNormalizedTokens(tokens, normName) || normInput.includes(normName);
      })
      .map(({ product }) => product)
      .slice(0, 5);
  }, [formName, editingProduct, indexedProducts]);

  // Exact duplicate product found (if any)
  const exactDuplicateMatch = useMemo(() => {
    const trimmed = formName.trim();
    if (!trimmed) return null;
    const normInput = normalizeArabicText(trimmed);
    return db.products.find(p => {
      if (editingProduct && p.id === editingProduct.id) return false;
      return normalizeArabicText(p.name) === normInput;
    }) || null;
  }, [formName, editingProduct, db.products]);

  // Open modal for new product (Collaborative: Anyone can add a new unlisted item!)
  const handleOpenAddModal = (presetCategory?: string) => {
    soundFx.playClick();
    setEditingProduct(null);
    setFormName('');
    setFormCategory(
      presetCategory || 
      (selectedCategory && selectedCategory !== 'ALL_ITEMS' ? selectedCategory : '') || 
      categoriesWithCounts[0]?.[0] || 
      'الورقيات'
    );
    setFormPrice('');
    setFormBuyWholesale('');
    setFormSellDozen('');
    setFormImage('');
    setFormError('');
    setIsModalOpen(true);
  };

  // Open modal for editing product (Protected: Store Owner Only)
  const handleOpenEditModal = (p: Product) => {
    soundFx.playClick();
    if (!isOwner) {
      onRequestOwnerLogin?.();
      return;
    }
    setEditingProduct(p);
    setFormName(p.name);
    setFormCategory(p.category || 'بدون مجموعة');
    setFormPrice(String(p.price));
    setFormBuyWholesale(p.buyWholesale != null ? String(p.buyWholesale) : '');
    setFormSellDozen(p.sellDozenRetail != null ? String(p.sellDozenRetail) : '');
    setFormImage(p.image || '');
    setFormError('');
    setIsModalOpen(true);
  };

  // Image file handler with auto-compression
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFormError('');
    try {
      setIsProcessingImage(true);
      const compressed = await compressImage(file, 480);
      setFormImage(compressed);
    } catch (err: unknown) {
      setFormError((err as Error).message || 'تعذر معالجة الصورة');
    } finally {
      setIsProcessingImage(false);
    }
  };

  // Save product submit
  const handleSaveProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const name = formName.trim();
    if (!name) {
      setFormError('يرجى كتابة اسم الصنف');
      return;
    }

    if (duplicateFound) {
      setFormError('اسم الصنف مسجل بالفعل! يرجى اختيار اسم مميز أو تعديل الصنف المسجل.');
      return;
    }

    const price = parseFloat(formPrice);
    if (isNaN(price) || price < 0) {
      setFormError('يرجى إدخال سعر بيع صحيح');
      return;
    }

    const buyWholesale = formBuyWholesale.trim() ? parseFloat(formBuyWholesale) : null;
    const sellDozen = formSellDozen.trim() ? parseFloat(formSellDozen) : null;

    const nowIso = new Date().toISOString();
    const newProduct: Product = {
      id: editingProduct ? editingProduct.id : Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      category: formCategory.trim() || 'بدون مجموعة',
      price,
      buyWholesale: buyWholesale != null && !isNaN(buyWholesale) ? buyWholesale : null,
      sellDozenRetail: sellDozen != null && !isNaN(sellDozen) ? sellDozen : null,
      image: formImage || undefined,
      createdAt: editingProduct ? editingProduct.createdAt : nowIso,
      updatedAt: nowIso,
    };

    onSaveProduct(newProduct);
    setIsModalOpen(false);
    showToast(editingProduct ? 'تم تحديث بيانات الصنف بنجاح' : 'تم إضافة الصنف بنجاح');
  };

  // Add new Category modal (Protected: Store Owner Only)
  const handleCreateNewCategory = () => {
    soundFx.playClick();
    if (!isOwner) {
      onRequestOwnerLogin?.();
      return;
    }
    setCategoryInput('');
    setCategoryModalError('');
    setCategoryModal({ mode: 'create' });
  };

  const handleToggleWholesale = () => {
    soundFx.playClick();
    if (!isOwner) {
      onRequestOwnerLogin?.();
      return;
    }
    setShowWholesalePrices(!showWholesalePrices);
  };

  const handleDeleteProductPrompt = (p: Product) => {
    soundFx.playClick();
    if (!isOwner) {
      onRequestOwnerLogin?.();
      return;
    }
    setPendingDeleteProduct(p);
  };

  const handleRenameCategoryPrompt = (catName: string) => {
    soundFx.playClick();
    if (!isOwner) {
      onRequestOwnerLogin?.();
      return;
    }
    setCategoryInput(catName);
    setCategoryModalError('');
    setCategoryModal({ mode: 'rename', oldName: catName });
  };

  const handleDeleteCategoryPrompt = (catName: string) => {
    soundFx.playClick();
    if (!isOwner) {
      onRequestOwnerLogin?.();
      return;
    }
    setPendingDeleteCategory(catName);
  };

  const handleCategoryModalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryModal) return;
    const trimmed = categoryInput.trim();
    if (!trimmed) {
      setCategoryModalError('يرجى كتابة اسم المجموعة أولاً');
      return;
    }

    if (categoryModal.mode === 'create') {
      const existingMatch = categoriesWithCounts.find(
        ([c]) => normalizeArabicText(c) === normalizeArabicText(trimmed)
      );
      if (existingMatch) {
        setCategoryModalError(`المجموعة «${existingMatch[0]}» موجودة بالفعل!`);
        return;
      }
      setCategoryModal(null);
      setSelectedCategory(trimmed);
      handleOpenAddModal(trimmed);
      return;
    }

    const oldName = categoryModal.oldName || '';
    if (trimmed !== oldName) {
      onRenameCategory(oldName, trimmed);
      if (selectedCategory === oldName) {
        setSelectedCategory(trimmed);
      }
      showToast('تم تعديل اسم المجموعة بنجاح');
    }
    setCategoryModal(null);
  };

  return (
    <div className="space-y-4">
      {/* Toast Notification with Success & Warning states */}
      {toast && (
        <div 
          className={`fixed bottom-5 left-5 z-50 text-xs font-bold px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 border transition-all animate-bounce-subtle ${
            toast.type === 'warning'
              ? 'bg-amber-50 text-amber-900 border-amber-300 shadow-amber-900/10'
              : 'bg-slate-900 text-white border-slate-700 shadow-slate-900/20'
          }`}
        >
          {toast.type === 'warning' ? (
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
          ) : (
            <Check className="w-5 h-5 text-emerald-400 shrink-0" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {/* Staff View Notice Banner (When not logged in as Owner) */}
      {!isOwner && (
        <div className="bg-amber-50 border border-amber-200/90 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-800 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <h4 className="font-bold text-xs sm:text-sm text-amber-950 flex items-center gap-1.5">
                <span>وضع موظف المتجر والكاشير (استعراض الأصناف والبحث وطلب النواقص)</span>
              </h4>
              <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                يمكن للجميع إضافة أصناف جديدة والمشاركة سحابياً مع باقي الأجهزة، بينما تعديل الأسعار الحالية أو المجموعات أو الحذف مقتصرة على صاحب المتجر فقط.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onRequestOwnerLogin}
            className="bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-xs transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <KeyRound className="w-4 h-4" />
            <span>دخول كصاحب متجر</span>
          </button>
        </div>
      )}

      {/* Top Universal Search Bar & Action Controls */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3.5">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Universal Search Bar across ALL groups */}
          <div className="relative flex-1">
            <Search className="w-5 h-5 text-slate-400 absolute right-3.5 top-3.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔍 ابحث هنا عن أي صنف في كل المجموعات (بالاسم، أو بالمجموعة)..."
              className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:bg-white rounded-xl pr-11 pl-10 py-3 text-xs sm:text-sm font-semibold text-slate-900 outline-none transition-all shadow-2xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute left-3 top-2.5 text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200"
                title="مسح البحث"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Action Buttons: Wholesale price toggle, Add product, Add category */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              onClick={handleToggleWholesale}
              className={`text-xs font-bold px-3 py-2.5 rounded-xl border transition-all flex items-center gap-1.5 cursor-pointer ${
                showWholesalePrices
                  ? 'bg-amber-50 text-amber-800 border-amber-300'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
              title={isOwner ? "سعر الشراء سري لصاحب المتجر فقط" : "متاح لصاحب المتجر فقط"}
            >
              {!isOwner ? (
                <Lock className="w-3.5 h-3.5 text-slate-400" />
              ) : showWholesalePrices ? (
                <EyeOff className="w-4 h-4 text-amber-600" />
              ) : (
                <Eye className="w-4 h-4 text-slate-500" />
              )}
              <span className="hidden sm:inline">
                {!isOwner ? 'سعر الشراء (للمالك)' : showWholesalePrices ? 'إخفاء سعر الجملة' : 'سعر الشراء جملة (سري)'}
              </span>
            </button>

            <button
              onClick={() => handleOpenAddModal()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
              title="إضافة صنف جديد وحفظه تلقائياً في السحابة لجميع الأجهزة"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة صنف جديد</span>
            </button>

            <button
              onClick={handleCreateNewCategory}
              className={`text-xs font-bold px-3.5 py-2.5 rounded-xl flex items-center gap-1.5 transition-all cursor-pointer ${
                isOwner
                  ? 'bg-slate-800 hover:bg-slate-900 text-white'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300'
              }`}
              title={isOwner ? "إنشاء وتسمية مجموعة جديدة" : "خاص بصاحب المتجر"}
            >
              {isOwner ? <FolderPlus className="w-4 h-4" /> : <Lock className="w-3.5 h-3.5 text-amber-600" />}
              <span className="hidden sm:inline">إنشاء مجموعة {isOwner ? '' : '(للمالك)'}</span>
            </button>
          </div>
        </div>

        {/* Categories / Navigation Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs scrollbar-thin">
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory(null);
            }}
            className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              selectedCategory === null && !searchQuery
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            <span>عرض المجموعات ({categoriesWithCounts.length})</span>
          </button>

          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('ALL_ITEMS');
            }}
            className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              selectedCategory === 'ALL_ITEMS' && !searchQuery
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>عرض جميع الأصناف ({db.products.length})</span>
          </button>

          {categoriesWithCounts.map(([catName, count]) => (
            <button
              key={catName}
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory(catName);
              }}
              className={`px-3 py-1.5 rounded-xl font-semibold transition-all whitespace-nowrap cursor-pointer ${
                selectedCategory === catName && !searchQuery
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <span>{catName}</span>
              <span className="opacity-75 font-mono mr-1">({count})</span>
            </button>
          ))}
        </div>

        {/* Product List Sort Controls */}
        <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <ProductSortBar
            sortField={sortField}
            sortDirection={sortDirection}
            onSelectField={handleSelectSortField}
            onToggleDirection={toggleDirection}
            compact
            accent="emerald"
          />
          {selectedCategory === null && !isSearchingAll && (
            <span className="text-[11px] text-slate-400 font-medium">
              اختر نوع الترتيب لعرض القائمة مرتبة مباشرة
            </span>
          )}
        </div>
      </div>

      {/* Main View: Either Search Results, Category Cards, or Products Table */}
      {isSearchingAll ? (
        /* Global Search Results Across ALL Categories */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-emerald-600" />
              <h2 className="font-bold text-sm text-slate-900">
                نتائج البحث في كل المجموعات
              </h2>
              <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2 py-0.5 rounded-full">
                {displayProducts.length} صنف مطابق
              </span>
            </div>
            <button
              onClick={() => setSearchQuery('')}
              className="text-xs text-slate-500 hover:text-slate-800 font-semibold"
            >
              إلغاء البحث والعودة
            </button>
          </div>

          {/* Search Results Table */}
          {displayProducts.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                    <th className="py-2.5 px-3">م</th>
                    <th className="py-2.5 px-3">اسم الصنف</th>
                    <th className="py-2.5 px-3">المجموعة</th>
                    <th className="py-2.5 px-3">سعر البيع قطاعي</th>
                    <th className="py-2.5 px-3">سعر الدستة قطاعي</th>
                    {isOwner && showWholesalePrices && (
                      <th className="py-2.5 px-3 bg-amber-50/70 text-amber-900">سعر الشراء جملة (سري)</th>
                    )}
                    <th className="py-2.5 px-3 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {displayProducts.map((p, idx) => {
                    const inShortage = isAlreadyInShortages(p.name);
                    return (
                      <tr key={p.id} className="perf-item hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-3 text-slate-400 font-mono">{idx + 1}</td>
                        <td className="py-2.5 px-3 font-bold text-slate-900">
                          <div className="flex items-center gap-2">
                            {p.image && (
                              <img
                                src={p.image}
                                alt={p.name}
                                loading="lazy"
                                decoding="async"
                                className="w-7 h-7 rounded object-cover border border-slate-200 shrink-0"
                              />
                            )}
                            <div className="flex flex-col">
                              <span>{p.name}</span>
                              {sortField === 'createdAt' && formatProductAddedDate(p) && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                                  <CalendarClock className="w-3 h-3 text-slate-400" />
                                  <span>أُضيف: {formatProductAddedDate(p)}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-semibold text-[11px]">
                            {p.category || 'بدون مجموعة'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-black text-emerald-600">
                          {formatCurrency(p.price)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700">
                          {p.sellDozenRetail != null ? formatCurrency(p.sellDozenRetail) : '—'}
                        </td>
                        {isOwner && showWholesalePrices && (
                          <td className="py-2.5 px-3 bg-amber-50/50 font-bold text-amber-900">
                            {p.buyWholesale != null ? formatCurrency(p.buyWholesale) : '—'}
                          </td>
                        )}
                        <td className="py-2.5 px-3">
                          <div className="flex items-center justify-center gap-1.5">
                            {/* Add to Shortages button with duplicate protection */}
                            <button
                              onClick={() => handleAddProductToShortage(p)}
                              className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                                inShortage
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
                                  : 'bg-amber-500 hover:bg-amber-600 text-white shadow-2xs'
                              }`}
                              title={inShortage ? 'هذا الصنف مضاف بالفعل لقائمة النواقص' : 'إضافة إلى دفتر النواقص'}
                            >
                              {inShortage ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-amber-700" />
                                  <span>مضاف للنواقص</span>
                                </>
                              ) : (
                                <>
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>+ النواقص</span>
                                </>
                              )}
                            </button>

                            <button
                              onClick={() => handleOpenEditModal(p)}
                              className="text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 font-semibold px-2 py-1 rounded-lg transition-colors cursor-pointer"
                              title="تعديل الصنف"
                            >
                              تعديل
                            </button>

                            <button
                              onClick={() => handleDeleteProductPrompt(p)}
                              className="text-rose-600 hover:bg-rose-50 p-1 rounded-lg transition-colors cursor-pointer"
                              title={isOwner ? "حذف الصنف" : "خاص بصاحب المتجر"}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center text-slate-400 text-sm space-y-2">
              <Search className="w-8 h-8 text-slate-300 mx-auto" />
              <p>لم يتم العثور على أي صنف يطابق بحثك «{searchQuery}» في كل المجموعات.</p>
              <button
                onClick={() => handleOpenAddModal()}
                className="bg-emerald-600 text-white text-xs font-bold px-4 py-2 rounded-xl inline-flex items-center gap-1.5 mt-2 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة صنف جديد بهذا الاسم</span>
              </button>
            </div>
          )}
        </div>
      ) : selectedCategory === null ? (
        /* Categories Cards View */
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {categoriesWithCounts.map(([catName, count]) => (
              <div
                key={catName}
                className="bg-white p-4 rounded-2xl border border-slate-200 hover:border-emerald-500 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group"
              >
                <div>
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                    <Folder className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base group-hover:text-emerald-700 transition-colors">
                    {catName}
                  </h3>
                  <span className="text-xs text-slate-500 block mt-1">
                    {count} صنف مسجل
                  </span>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-1">
                  <button
                    onClick={() => setSelectedCategory(catName)}
                    className="text-xs bg-slate-900 hover:bg-emerald-700 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors flex-1 cursor-pointer"
                  >
                    عرض الأصناف ›
                  </button>
                  <button
                    onClick={() => handleRenameCategoryPrompt(catName)}
                    className="text-xs text-slate-400 hover:text-slate-700 p-1.5 rounded cursor-pointer"
                    title={isOwner ? "تعديل اسم المجموعة" : "خاص بصاحب المتجر"}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteCategoryPrompt(catName)}
                    className="text-xs text-rose-400 hover:text-rose-700 p-1.5 rounded cursor-pointer"
                    title={isOwner ? "حذف المجموعة" : "خاص بصاحب المتجر"}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Category or All Items Table View */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedCategory(null)}
                className="text-xs font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>رجوع للمجموعات</span>
              </button>
              <h2 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
                <Folder className="w-4 h-4 text-emerald-600" />
                <span>{selectedCategory === 'ALL_ITEMS' ? 'كافة الأصناف المسجلة' : selectedCategory}</span>
              </h2>
              <span className="bg-slate-100 text-slate-700 text-[11px] font-bold px-2 py-0.5 rounded-full">
                {displayProducts.length} صنف
              </span>
            </div>

            <button
              onClick={() => handleOpenAddModal(selectedCategory !== 'ALL_ITEMS' ? selectedCategory : undefined)}
              className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة صنف هنا</span>
            </button>
          </div>

          {/* Products Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                  <th className="py-2.5 px-3">م</th>
                  <th className="py-2.5 px-3">اسم الصنف</th>
                  {selectedCategory === 'ALL_ITEMS' && (
                    <th className="py-2.5 px-3">المجموعة</th>
                  )}
                  <th className="py-2.5 px-3">سعر البيع قطاعي</th>
                  <th className="py-2.5 px-3">سعر الدستة قطاعي</th>
                  {isOwner && showWholesalePrices && (
                    <th className="py-2.5 px-3 bg-amber-50/70 text-amber-900">سعر الشراء جملة (سري)</th>
                  )}
                  <th className="py-2.5 px-3 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayProducts.map((p, idx) => {
                  const inShortage = isAlreadyInShortages(p.name);
                  return (
                    <tr key={p.id} className="perf-item hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 text-slate-400 font-mono">{idx + 1}</td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">
                        <div className="flex items-center gap-2.5">
                          {p.image ? (
                            <button
                              type="button"
                              onClick={() => {
                                soundFx.playClick();
                                setZoomedProduct({ url: p.image!, title: p.name, category: p.category, price: p.price });
                              }}
                              className="relative group w-11 h-11 rounded-xl overflow-hidden border border-slate-300 shadow-2xs shrink-0 cursor-pointer hover:border-emerald-500 transition-all bg-slate-50"
                              title="اضغط لتكبير صورة الصنف"
                            >
                              <img
                                src={p.image}
                                alt={p.name}
                                loading="lazy"
                                decoding="async"
                                className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                              />
                              <span className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                                <ZoomIn className="w-4 h-4" />
                              </span>
                            </button>
                          ) : (
                            <div className="w-11 h-11 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                              <ImageIcon className="w-5 h-5 opacity-40" />
                            </div>
                          )}
                          <div className="flex flex-col">
                            <span className="text-slate-900 font-bold text-xs sm:text-sm">{p.name}</span>
                            {p.category && (
                              <span className="text-[10.5px] text-slate-400 font-medium sm:hidden">{p.category}</span>
                            )}
                            {sortField === 'createdAt' && formatProductAddedDate(p) && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 font-medium mt-0.5">
                                <CalendarClock className="w-3 h-3 text-slate-400" />
                                <span>أُضيف: {formatProductAddedDate(p)}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      {selectedCategory === 'ALL_ITEMS' && (
                        <td className="py-2.5 px-3">
                          <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-semibold text-[11px]">
                            {p.category || 'بدون مجموعة'}
                          </span>
                        </td>
                      )}
                      <td className="py-2.5 px-3 font-black text-emerald-600">
                        {formatCurrency(p.price)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700">
                        {p.sellDozenRetail != null ? formatCurrency(p.sellDozenRetail) : '—'}
                      </td>
                      {isOwner && showWholesalePrices && (
                        <td className="py-2.5 px-3 bg-amber-50/50 font-bold text-amber-900">
                          {p.buyWholesale != null ? formatCurrency(p.buyWholesale) : '—'}
                        </td>
                      )}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Add to Shortages button with duplicate protection */}
                          <button
                            onClick={() => handleAddProductToShortage(p)}
                            className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                              inShortage
                                ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
                                : 'bg-amber-500 hover:bg-amber-600 text-white shadow-2xs'
                            }`}
                            title={inShortage ? 'هذا الصنف مضاف بالفعل لقائمة النواقص' : 'إضافة إلى دفتر النواقص'}
                          >
                            {inShortage ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-amber-700" />
                                <span>مضاف للنواقص</span>
                              </>
                            ) : (
                              <>
                                <Plus className="w-3.5 h-3.5" />
                                <span>+ النواقص</span>
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => handleOpenEditModal(p)}
                            className="text-xs bg-slate-100 text-slate-700 hover:bg-slate-200 font-semibold px-2 py-1 rounded-lg transition-colors cursor-pointer"
                            title="تعديل الصنف"
                          >
                            تعديل
                          </button>

                          <button
                            onClick={() => handleDeleteProductPrompt(p)}
                            className="text-rose-600 hover:bg-rose-50 p-1 rounded-lg transition-colors cursor-pointer"
                            title={isOwner ? "حذف الصنف" : "خاص بصاحب المتجر"}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {displayProducts.length === 0 && (
              <div className="py-12 text-center text-slate-400 text-sm">
                لا توجد أصناف مسجلة في هذا القسم حالياً. اضغط «إضافة صنف» للبدء.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add / Edit Product Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <Package className="w-5 h-5 text-emerald-600" />
                <span>{editingProduct ? 'تعديل صنف' : 'إضافة صنف جديد'}</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProductSubmit} className="space-y-3 text-xs">
              {formError && (
                <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 rounded-xl font-bold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}
              {/* Product Name with Smart Suggestions & Duplicate Alerts */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  اسم الصنف <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="مثال: كشكول سلك 80 ورقة، قلم حبر، مسطرة..."
                  className={`w-full bg-slate-50 border rounded-xl py-2 px-3 text-xs font-semibold outline-none transition-all ${
                    duplicateFound
                      ? 'border-rose-400 bg-rose-50/50 text-rose-900 focus:ring-rose-400'
                      : 'border-slate-300 focus:border-emerald-500'
                  }`}
                />

                {/* Exact Duplicate Warning */}
                {exactDuplicateMatch && (
                  <div className="bg-rose-50 border border-rose-300 rounded-xl p-2.5 text-xs text-rose-900 space-y-1 mt-2">
                    <div className="font-bold flex items-center gap-1.5 text-rose-800">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>⚠️ تنبيه: هذا الصنف مسجل بالفعل في النظام!</span>
                    </div>
                    <p className="text-[11px] text-rose-700 leading-relaxed">
                      الصنف <strong>«{exactDuplicateMatch.name}»</strong> مسجل في مجموعة <strong>[{exactDuplicateMatch.category}]</strong> بسعر <strong>{formatCurrency(exactDuplicateMatch.price)}</strong>.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        soundFx.playClick();
                        handleOpenEditModal(exactDuplicateMatch);
                      }}
                      className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] px-3 py-1 rounded-lg mt-1 inline-flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>تعديل الصنف المسجل بدلاً من إنشاء مكرر</span>
                    </button>
                  </div>
                )}

                {/* Similar Existing Products Suggestions (As user types) */}
                {!exactDuplicateMatch && matchingSuggestions.length > 0 && (
                  <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-2.5 text-xs mt-2 space-y-1.5">
                    <div className="flex items-center justify-between font-bold text-amber-900 text-[11px]">
                      <span className="flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                        <span>أصناف مسجلة قريبة من هذا الاسم ({matchingSuggestions.length}):</span>
                      </span>
                      <span className="text-amber-700 text-[10px]">تأكد قبل التسجيل</span>
                    </div>
                    <div className="divide-y divide-amber-200/70 max-h-36 overflow-y-auto pr-1">
                      {matchingSuggestions.map(sug => (
                        <div key={sug.id} className="py-1.5 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <span className="font-bold text-slate-800 block truncate text-xs">{sug.name}</span>
                            <span className="text-[10px] text-slate-500">
                              {sug.category} · بسعر: <strong className="text-emerald-700 font-bold">{formatCurrency(sug.price)}</strong>
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                soundFx.playClick();
                                setFormName(sug.name);
                              }}
                              className="text-[10px] font-semibold bg-white hover:bg-amber-100 text-slate-700 border border-slate-300 px-1.5 py-0.5 rounded cursor-pointer"
                              title="نسخ الاسم"
                            >
                              استخدام
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                soundFx.playClick();
                                handleOpenEditModal(sug);
                              }}
                              className="text-[10px] font-bold bg-amber-500 hover:bg-amber-600 text-white px-2 py-0.5 rounded cursor-pointer transition-colors shadow-2xs"
                              title="تعديل هذا الصنف المسجل"
                            >
                              تعديل
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Category */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  المجموعة / التصنيف <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  list="categories-list"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  placeholder="اكتب أو اختر اسم المجموعة..."
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-500 rounded-xl py-2 px-3 text-xs font-semibold outline-none"
                />
                <datalist id="categories-list">
                  {categoriesWithCounts.map(([cat]) => (
                    <option key={cat} value={cat} />
                  ))}
                </datalist>
              </div>

              {/* Price Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    سعر البيع قطاعي (ج.م) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-500 rounded-xl py-2 px-3 text-xs font-bold outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    سعر البيع بالدستة قطاعي (اختياري)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formSellDozen}
                    onChange={(e) => setFormSellDozen(e.target.value)}
                    placeholder="اختياري"
                    className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-500 rounded-xl py-2 px-3 text-xs font-bold outline-none"
                  />
                </div>
              </div>

              {/* Wholesale Buy Price (Secret: Owner Only) */}
              {isOwner && (
                <div className="bg-amber-50/60 border border-amber-200/80 p-3 rounded-xl space-y-1">
                  <label className="block font-bold text-amber-900">
                    سعر الشراء جملة (سري — خاص بصاحب المتجر فقط)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formBuyWholesale}
                    onChange={(e) => setFormBuyWholesale(e.target.value)}
                    placeholder="سعر التكلفة من تاجر الجملة"
                    className="w-full bg-white border border-amber-300 focus:border-amber-500 rounded-lg py-2 px-3 text-xs font-bold outline-none"
                  />
                  <span className="text-[10px] text-amber-700 block">
                    سري للغاية: لا يظهر للعملاء أو الموظفين، ويستخدم لحساب صافي الأرباح والتكاليف.
                  </span>
                </div>
              )}

              {/* Product Photo Upload with Direct Camera & Gallery */}
              <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-2xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="block font-bold text-slate-800 text-xs flex items-center gap-1.5">
                    <Camera className="w-4 h-4 text-emerald-600" />
                    <span>صورة الصنف (تصوير فوري بالكاميرا أو اختيار من المعرض)</span>
                  </label>
                  {isProcessingImage && (
                    <span className="text-[11px] text-amber-700 font-bold animate-pulse">
                      جاري معالجة وضغط الصورة...
                    </span>
                  )}
                </div>

                {/* Hidden File Inputs: One for Camera and One for Gallery */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />

                {formImage ? (
                  <div className="flex flex-col sm:flex-row items-center gap-3 bg-white p-3 rounded-xl border border-slate-300">
                    <div className="relative group w-28 h-28 sm:w-32 sm:h-32 rounded-xl overflow-hidden border border-slate-300 shadow-sm shrink-0 bg-slate-100">
                      <img
                        src={formImage}
                        alt="معاينة الصنف"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          soundFx.playClick();
                          setZoomedProduct({ url: formImage, title: formName || 'معاينة الصنف', category: formCategory, price: parseFloat(formPrice) || 0 });
                        }}
                        className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity font-bold text-xs gap-1 cursor-pointer"
                        title="معاينة مكبرة فائقة الوضوح"
                      >
                        <ZoomIn className="w-4 h-4" />
                        <span>تكبير</span>
                      </button>
                    </div>

                    <div className="flex-1 space-y-2 text-center sm:text-right">
                      <div className="text-xs font-bold text-emerald-800 flex items-center justify-center sm:justify-start gap-1">
                        <Check className="w-4 h-4 text-emerald-600" />
                        <span>تم التقاط وحفظ صورة الصنف بنجاح</span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        الصورة واضحة ومضغوطة تلقائياً وتُحفظ مباشرة في النسخ الاحتياطي ومزامنة Google Drive.
                      </p>
                      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => cameraInputRef.current?.click()}
                          className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <Camera className="w-3.5 h-3.5 text-emerald-600" />
                          <span>إعادة تصوير</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => galleryInputRef.current?.click()}
                          className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5 text-indigo-600" />
                          <span>تغيير من المعرض</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setFormImage('')}
                          className="text-xs bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>حذف الصورة</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="bg-white hover:bg-emerald-50/80 border-2 border-dashed border-emerald-300 hover:border-emerald-500 p-3.5 rounded-xl flex flex-col items-center justify-center text-center gap-1.5 transition-all cursor-pointer group"
                    >
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Camera className="w-5 h-5" />
                      </div>
                      <span className="font-bold text-xs text-slate-800">📸 تصوير مباشر بالكاميرا</span>
                      <span className="text-[10px] text-slate-500">التقط صورة لغلاف الكتاب أو علبة الصنف</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => galleryInputRef.current?.click()}
                      className="bg-white hover:bg-indigo-50/80 border-2 border-dashed border-indigo-300 hover:border-indigo-500 p-3.5 rounded-xl flex flex-col items-center justify-center text-center gap-1.5 transition-all cursor-pointer group"
                    >
                      <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Upload className="w-5 h-5" />
                      </div>
                      <span className="font-bold text-xs text-slate-800">🖼️ اختيار من المعرض / الملفات</span>
                      <span className="text-[10px] text-slate-500">اختر من ألبوم الصور المحفوظة على جهازك</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Form Buttons */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2 rounded-xl transition-colors cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={duplicateFound || isProcessingImage}
                  className={`bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2 rounded-xl shadow transition-colors flex items-center gap-1.5 cursor-pointer ${
                    duplicateFound || isProcessingImage ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <Check className="w-4 h-4" />
                  <span>{editingProduct ? 'حفظ التعديلات' : 'تسجيل الصنف'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Crisp Image Inspection Modal */}
      <ImageModal
        isOpen={!!zoomedProduct}
        imageUrl={zoomedProduct?.url || ''}
        title={zoomedProduct?.title || ''}
        category={zoomedProduct?.category}
        price={zoomedProduct?.price}
        onClose={() => setZoomedProduct(null)}
      />

      {/* Confirm Delete Product -> Soft Delete to 30-Day Trash Bin */}
      <ConfirmModal
        isOpen={Boolean(pendingDeleteProduct)}
        title="نقل الصنف إلى سلة المهملات"
        description={`هل أنت متأكد من حذف صنف «${pendingDeleteProduct?.name || ''}»؟ سيُحفظ في سلة المهملات لمدة 30 يوماً ويمكنك استرجاعه في أي وقت خلال الشهر.`}
        confirmLabel="حذف ونقل للسلة"
        isDestructive={true}
        onConfirm={() => {
          if (pendingDeleteProduct) {
            onDeleteProduct(pendingDeleteProduct.id);
            showToast('تم نقل الصنف إلى سلة المهملات (يُحفظ لمدة 30 يوماً)');
            setPendingDeleteProduct(null);
          }
        }}
        onCancel={() => setPendingDeleteProduct(null)}
      />

      {/* Confirm Delete Category */}
      <ConfirmModal
        isOpen={Boolean(pendingDeleteCategory)}
        title="حذف مجموعة أصناف"
        description={`هل أنت متأكد من حذف مجموعة «${pendingDeleteCategory || ''}»؟ سيتم تحويل جميع أصنافها إلى (بدون مجموعة) دون حذف أي صنف.`}
        confirmLabel="نعم، حذف المجموعة"
        isDestructive={true}
        onConfirm={() => {
          if (pendingDeleteCategory) {
            onDeleteCategory(pendingDeleteCategory);
            if (selectedCategory === pendingDeleteCategory) {
              setSelectedCategory(null);
            }
            showToast('تم حذف المجموعة وتحويل أصنافها بنجاح');
            setPendingDeleteCategory(null);
          }
        }}
        onCancel={() => setPendingDeleteCategory(null)}
      />

      {/* Create / Rename Category Modal */}
      {categoryModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                <FolderPlus className="w-5 h-5 text-emerald-600" />
                <span>
                  {categoryModal.mode === 'create'
                    ? 'إضافة مجموعة جديدة'
                    : `تعديل اسم مجموعة «${categoryModal.oldName}»`}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setCategoryModal(null)}
                aria-label="إغلاق النافذة"
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCategoryModalSubmit} className="space-y-3 text-xs">
              {categoryModalError && (
                <div role="alert" className="bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 rounded-xl font-bold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{categoryModalError}</span>
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 mb-1.5">
                  اسم المجموعة (مثال: أقلام، كشاكيل، هدايا)
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={categoryInput}
                  onChange={(e) => {
                    setCategoryInput(e.target.value);
                    if (categoryModalError) setCategoryModalError('');
                  }}
                  placeholder="اكتب اسم المجموعة..."
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-500 focus:bg-white rounded-xl py-2.5 px-3 text-sm font-bold outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCategoryModal(null)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2 rounded-xl shadow cursor-pointer flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{categoryModal.mode === 'create' ? 'متابعة وإضافة صنف' : 'حفظ الاسم الجديد'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
