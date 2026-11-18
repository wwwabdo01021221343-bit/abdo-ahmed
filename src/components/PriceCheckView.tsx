import React, { useState, useMemo, useDeferredValue } from 'react';
import { 
  Tag, 
  Search, 
  ShoppingCart, 
  Plus, 
  Check, 
  Layers, 
  Package,
  ShieldCheck,
  ArrowRight,
  ZoomIn,
  Image as ImageIcon,
  CalendarClock
} from 'lucide-react';
import { AppDatabase, Product } from '../types';
import {
  formatCurrency,
  formatProductAddedDate,
  matchesNormalizedTokens,
  normalizeArabicSearchText,
  normalizeArabicText,
  sortProducts,
  tokenizeArabicSearch,
} from '../utils/shopLogic';
import { soundFx } from '../utils/audioFeedback';
import { ImageModal } from './ImageModal';
import { ProductSortBar, useProductSort } from './ProductSortBar';

interface PriceCheckViewProps {
  db: AppDatabase;
  onNavigate: (tab: string) => void;
  onAddToCart: (product: Product) => void;
  onAddToShortage: (product: Product) => { added: boolean; message: string };
}

export const PriceCheckView: React.FC<PriceCheckViewProps> = ({
  db,
  onNavigate,
  onAddToCart,
  onAddToShortage,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [selectedCategory, setSelectedCategory] = useState<string>('الكل');
  const [zoomedProduct, setZoomedProduct] = useState<{ url: string; title: string; category?: string; price?: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'warning' } | null>(null);
  const { sortField, sortDirection, selectSortField, toggleDirection } = useProductSort();

  const showToast = (toastObj: { text: string; type: 'success' | 'warning' }) => {
    setToast(toastObj);
    setTimeout(() => setToast(null), 3000);
  };

  // Pre-sort & pre-normalize products once
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

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of indexedProducts) {
      set.add(item.cleanCategory);
    }
    return ['الكل', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'))];
  }, [indexedProducts]);

  // Filtered products (fast, already sorted, supports multi-word out-of-order matching!)
  const filteredProducts = useMemo(() => {
    const tokens = tokenizeArabicSearch(deferredSearchQuery);
    return indexedProducts
      .filter((item) => {
        if (selectedCategory !== 'الكل' && item.cleanCategory !== selectedCategory) return false;
        if (tokens.length === 0) return true;
        return matchesNormalizedTokens(tokens, item.normName, item.normCat);
      })
      .map((item) => item.product);
  }, [indexedProducts, selectedCategory, deferredSearchQuery]);

  // O(1) Shortage status lookup
  const shortageNamesSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of db.shortages) {
      set.add(normalizeArabicText(s.name));
    }
    return set;
  }, [db.shortages]);

  const isInShortages = (productName: string) => {
    return shortageNamesSet.has(normalizeArabicText(productName));
  };

  const handleAddShortage = (product: Product) => {
    const res = onAddToShortage(product);
    if (res && !res.added) {
      soundFx.playWarning();
      showToast({ text: res.message || '⚠️ الصنف مضاف بالفعل لقائمة النواقص!', type: 'warning' });
    } else {
      soundFx.playSuccess();
      showToast({ text: `✓ تمت إضافة «${product.name}» إلى قائمة النواقص`, type: 'success' });
    }
  };

  const handleAddCart = (product: Product) => {
    soundFx.playBeep();
    onAddToCart(product);
    showToast({ text: `✓ تمت إضافة «${product.name}» إلى سلة الفاتورة`, type: 'success' });
  };

  return (
    <div className="space-y-5">
      {/* Top Banner: Read-Only Notice & Back to Home */}
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 text-white p-5 rounded-2xl shadow-md border border-indigo-700/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-2 bg-indigo-500/30 rounded-xl border border-indigo-400/30">
              <Tag className="w-5 h-5 text-indigo-300" />
            </span>
            <h1 className="text-xl font-black tracking-tight">كشف ودليل الأسعار السريع</h1>
            <span className="bg-emerald-500/20 text-emerald-300 text-xs px-2.5 py-0.5 rounded-full font-bold border border-emerald-500/30 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              عرض آمن بدون تعديل
            </span>
          </div>
          <p className="text-xs text-indigo-200">
            مخصص للاستعلام الفوري ومعرفة سعر أي صنف للزبائن دون الخوف من حذف أو تعديل الأسعار بالخطأ.
          </p>
        </div>

        <button
          onClick={() => onNavigate('home')}
          className="self-end md:self-auto bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-4 py-2.5 rounded-xl flex items-center gap-2 border border-white/20 transition-all cursor-pointer"
        >
          <ArrowRight className="w-4 h-4" />
          <span>الرجوع للرئيسية</span>
        </button>
      </div>

      {/* Search & Category Filter Bar */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
        {/* Search Input */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث بالاسم أو التصنيف (مثال: كشكول، قلم جاف، مسطرة، صلصال)..."
            className="w-full bg-slate-50 hover:bg-white focus:bg-white border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-xl py-3 px-4 text-sm font-semibold transition-all outline-none"
            autoFocus
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute left-3 top-3 text-xs text-slate-400 hover:text-slate-600 bg-slate-200 hover:bg-slate-300 px-2.5 py-1 rounded-lg cursor-pointer"
            >
              مسح
            </button>
          )}
        </div>

        {/* Categories Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-1 pt-1">
          {categories.map((cat) => {
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Sort Bar */}
        <div className="pt-2 border-t border-slate-100">
          <ProductSortBar
            sortField={sortField}
            sortDirection={sortDirection}
            onSelectField={selectSortField}
            onToggleDirection={toggleDirection}
            compact
            accent="indigo"
          />
        </div>
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1 font-semibold">
        <span>عرض {filteredProducts.length} من إجمالي {db.products.length} صنف</span>
        <span>الأسعار بالجنيه المصري (ج.م)</span>
      </div>

      {/* Products Price Table / Grid */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
                <th className="py-3 px-4">الصنف</th>
                <th className="py-3 px-3">المجموعة</th>
                <th className="py-3 px-4 text-left">سعر البيع قطاعي</th>
                <th className="py-3 px-4 text-left hidden sm:table-cell">سعر الدستة قطاعي</th>
                <th className="py-3 px-4 text-center">إجراء سريع</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredProducts.map((p) => {
                const inShortages = isInShortages(p.name);
                return (
                  <tr key={p.id} className="perf-item hover:bg-indigo-50/40 transition-colors">
                    {/* Item Name & Photo */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        {p.image ? (
                          <button
                            type="button"
                            onClick={() => {
                              soundFx.playClick();
                              setZoomedProduct({ url: p.image!, title: p.name, category: p.category, price: p.price });
                            }}
                            className="relative group w-11 h-11 sm:w-12 sm:h-12 rounded-xl overflow-hidden border border-slate-300 shadow-2xs shrink-0 cursor-pointer hover:border-indigo-500 transition-all bg-slate-50"
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
                          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                            <ImageIcon className="w-5 h-5 opacity-40" />
                          </div>
                        )}
                        <div>
                          <div className="font-bold text-slate-900 text-sm sm:text-base">{p.name}</div>
                          {p.category && (
                            <span className="text-[11px] text-slate-500 sm:hidden">{p.category}</span>
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

                    {/* Category */}
                    <td className="py-3 px-3">
                      <span className="inline-block bg-slate-100 text-slate-700 text-xs font-semibold px-2.5 py-0.5 rounded-md">
                        {p.category || 'بدون مجموعة'}
                      </span>
                    </td>

                    {/* Retail Price */}
                    <td className="py-3 px-4 text-left">
                      <span className="font-black text-emerald-600 text-base sm:text-lg">
                        {formatCurrency(p.price)}
                      </span>
                    </td>

                    {/* Dozen Retail Price */}
                    <td className="py-3 px-4 text-left hidden sm:table-cell">
                      {p.sellDozenRetail ? (
                        <span className="font-bold text-indigo-700 text-xs sm:text-sm">
                          {formatCurrency(p.sellDozenRetail)}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>

                    {/* Quick Add Actions */}
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleAddCart(p)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1 shadow-xs cursor-pointer transition-colors"
                          title="إضافة للفاتورة"
                        >
                          <ShoppingCart className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">للفاتورة</span>
                        </button>

                        <button
                          onClick={() => handleAddShortage(p)}
                          className={`text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-colors cursor-pointer ${
                            inShortages
                              ? 'bg-amber-100 text-amber-900 border border-amber-300'
                              : 'bg-amber-500 hover:bg-amber-600 text-white shadow-xs'
                          }`}
                          title="إضافة للنواقص"
                        >
                          {inShortages ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-amber-800" />
                              <span className="hidden sm:inline">مضاف</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">نواقص</span>
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredProducts.length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm">
              لا توجد أصناف تطابق البحث «{searchQuery}».
            </div>
          )}
        </div>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div 
          className={`fixed bottom-5 left-5 z-50 text-xs font-bold px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 border transition-all animate-bounce-subtle ${
            toast.type === 'warning'
              ? 'bg-amber-50 text-amber-900 border-amber-300 shadow-amber-900/10'
              : 'bg-slate-900 text-white border-slate-700 shadow-slate-900/20'
          }`}
        >
          <span>{toast.text}</span>
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
    </div>
  );
};
