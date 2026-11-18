import React, { useState, useMemo, useDeferredValue } from 'react';
import { 
  ClipboardList, 
  Plus, 
  Trash2, 
  Printer, 
  MessageCircle, 
  AlertTriangle, 
  CheckCircle2, 
  Layers, 
  Search,
  Filter,
  CheckSquare,
  Square,
  X,
  SlidersHorizontal,
  Eye,
  Lock
} from 'lucide-react';
import { AppDatabase, ShortageItem } from '../types';
import { 
  generateShortagesWhatsAppText, 
  getShortagesPrintLayout,
  matchesArabicSearchQuery,
  normalizeArabicText, 
  ShortagesPrintColumnPref,
  splitIntoColumns 
} from '../utils/shopLogic';
import { soundFx } from '../utils/audioFeedback';
import { ConfirmModal } from './ConfirmModal';

interface ShortagesViewProps {
  db: AppDatabase;
  onSaveShortages: (items: { name: string; quantity: number; category?: string; notes?: string }[]) => void;
  onToggleShortageStatus: (id: string) => void;
  onUpdateShortageQuantity: (id: string, quantity: number) => void;
  onUpdateShortageNotes?: (id: string, notes: string) => void;
  onDeleteShortage: (id: string) => void;
  onDeleteAllShortages: () => void;
  isOwner?: boolean;
  onOpenOwnerModal?: () => void;
}

export const ShortagesView: React.FC<ShortagesViewProps> = ({
  db,
  onSaveShortages,
  onToggleShortageStatus,
  onUpdateShortageQuantity,
  onUpdateShortageNotes,
  onDeleteShortage,
  onDeleteAllShortages,
  isOwner = false,
  onOpenOwnerModal
}) => {
  // Quick direct add state
  const [inputName, setInputName] = useState<string>('');
  const [inputQty, setInputQty] = useState<number>(1);
  const [inputCategory, setInputCategory] = useState<string>('');
  const [inputNotes, setInputNotes] = useState<string>('');

  // Search & view options
  const [searchFilter, setSearchFilter] = useState<string>('');
  const deferredSearchFilter = useDeferredValue(searchFilter);
  const [groupByCategory, setGroupByCategory] = useState<boolean>(true);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'warning' } | null>(null);

  // Print & Category Exclusion Filter State
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);
  const [selectedCategoriesForPrint, setSelectedCategoriesForPrint] = useState<string[]>([]);
  const [printFormat, setPrintFormat] = useState<'compact' | 'grouped'>('compact');
  const [printColsPref, setPrintColsPref] = useState<ShortagesPrintColumnPref>('auto');
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState<boolean>(false);
  const [pendingDeleteShortage, setPendingDeleteShortage] = useState<ShortageItem | null>(null);

  // Available categories for dropdown / suggestions
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    db.products.forEach(p => {
      const c = (p.category || 'بدون مجموعة').trim();
      if (c) set.add(c);
    });
    db.shortages.forEach(s => {
      const c = (s.category || 'بدون مجموعة').trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [db.products, db.shortages]);

  // Toast feedback helper
  const showToast = (toastObj: { text: string; type: 'success' | 'warning' } | string) => {
    if (typeof toastObj === 'string') {
      setToast({ text: toastObj, type: 'success' });
    } else {
      setToast(toastObj);
    }
    setTimeout(() => setToast(null), 3000);
  };

  // Auto-detect category when typing product name
  const handleNameChange = (val: string) => {
    setInputName(val);
    const matched = db.products.find(
      p => normalizeArabicText(p.name) === normalizeArabicText(val)
    );
    if (matched && matched.category) {
      setInputCategory(matched.category);
    }
  };

  // Direct add to shortages
  const handleQuickAdd = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const raw = inputName.trim();
    if (!raw) return;

    // Check if already in shortages
    const alreadyInActive = db.shortages.some(
      s => !s.done && normalizeArabicText(s.name) === normalizeArabicText(raw)
    );
    if (alreadyInActive) {
      soundFx.playWarning();
      showToast({
        text: `⚠️ هذا الصنف «${raw}» موجود بالفعل في قائمة النواقص!`,
        type: 'warning'
      });
      return;
    }

    // Auto resolve category if not selected
    const matchedProduct = db.products.find(
      p => normalizeArabicText(p.name) === normalizeArabicText(raw)
    );
    const resolvedCat = inputCategory.trim() || 
      (matchedProduct ? (matchedProduct.category || 'بدون مجموعة').trim() : 'بدون مجموعة');

    onSaveShortages([
      {
        name: raw,
        quantity: Math.max(1, inputQty),
        category: resolvedCat,
        notes: inputNotes.trim() || undefined
      }
    ]);

    soundFx.playSuccess();
    showToast({
      text: `✓ تمت إضافة «${raw}» (${Math.max(1, inputQty)}) إلى قائمة النواقص`,
      type: 'success'
    });

    setInputName('');
    setInputQty(1);
    setInputCategory('');
    setInputNotes('');
  };

  // Memoized datalist options so 355+ products aren't rebuilt on every keystroke/quantity tap
  const productDatalistOptions = useMemo(
    () =>
      db.products.map((p) => (
        <option key={p.id} value={p.name}>
          {p.category} — {p.price} ج.م
        </option>
      )),
    [db.products]
  );

  // Active shortages list (Always sorted alphabetically by Arabic name; supports multi-word out-of-order search)
  const activeShortages = useMemo(() => {
    return db.shortages
      .filter(s => matchesArabicSearchQuery(deferredSearchFilter, s.name, s.category || ''))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [db.shortages, deferredSearchFilter]);

  // Grouped active shortages by category (with items in each category sorted alphabetically)
  const groupedActiveShortages = useMemo(() => {
    const map = new Map<string, ShortageItem[]>();
    for (const item of activeShortages) {
      const cat = (item.category || 'بدون مجموعة').trim() || 'بدون مجموعة';
      if (!map.has(cat)) {
        map.set(cat, []);
      }
      map.get(cat)!.push(item);
    }
    // Sort items within each category alphabetically
    for (const [, items] of map) {
      items.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'ar'));
  }, [activeShortages]);

  // Active shortages categories with count
  const activeCategoriesSummary = useMemo(() => {
    const map = new Map<string, number>();
    db.shortages.forEach(s => {
      const cat = (s.category || 'بدون مجموعة').trim() || 'بدون مجموعة';
      map.set(cat, (map.get(cat) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [db.shortages]);

  // Handle opening print modal with automatic default selection of all active categories
  const handleOpenPrintModal = () => {
    soundFx.playClick();
    if (selectedCategoriesForPrint.length === 0) {
      setSelectedCategoriesForPrint(activeCategoriesSummary.map(c => c.name));
    }
    setIsPrintModalOpen(true);
  };

  // Toggle category in print selection
  const handleToggleCategoryPrint = (catName: string) => {
    setSelectedCategoriesForPrint(prev => {
      if (prev.includes(catName)) {
        return prev.filter(c => c !== catName);
      } else {
        return [...prev, catName];
      }
    });
  };

  // Filter out accessories (one-click shortcut for user's explicit use case)
  const handleExcludeAccessories = () => {
    soundFx.playClick();
    setSelectedCategoriesForPrint(prev => 
      prev.filter(c => !c.includes('اكسسوار') && !c.includes('إكسسوار'))
    );
  };

  // Select all categories
  const handleSelectAllCategories = () => {
    soundFx.playClick();
    setSelectedCategoriesForPrint(activeCategoriesSummary.map(c => c.name));
  };

  // Clear all categories
  const handleDeselectAllCategories = () => {
    soundFx.playClick();
    setSelectedCategoriesForPrint([]);
  };

  // Shortages items that are selected for printing
  const printFilteredShortages = useMemo(() => {
    const allowed = new Set(selectedCategoriesForPrint);
    return activeShortages.filter(item => {
      const cat = (item.category || 'بدون مجموعة').trim() || 'بدون مجموعة';
      return allowed.has(cat);
    });
  }, [activeShortages, selectedCategoriesForPrint]);

  // Grouped shortages for print
  const printGroupedShortages = useMemo(() => {
    const map = new Map<string, ShortageItem[]>();
    for (const item of printFilteredShortages) {
      const cat = (item.category || 'بدون مجموعة').trim() || 'بدون مجموعة';
      if (!map.has(cat)) {
        map.set(cat, []);
      }
      map.get(cat)!.push(item);
    }
    for (const [, items] of map) {
      items.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'ar'));
  }, [printFilteredShortages]);

  // Single-page adaptive column & font layout (1-4 columns)
  const compactLayout = useMemo(
    () => getShortagesPrintLayout(printFilteredShortages.length, printColsPref),
    [printFilteredShortages.length, printColsPref]
  );

  const printMultiColumns = useMemo(() => {
    return splitIntoColumns(printFilteredShortages, compactLayout.columns);
  }, [printFilteredShortages, compactLayout.columns]);

  // Execute print with pure white isolation
  const handleExecutePrint = () => {
    soundFx.playSuccess();
    document.body.classList.remove('print-receipt-mode', 'print-invoice-a4');
    document.body.classList.add('print-shortages-mode');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('print-shortages-mode');
    }, 1000);
  };

  return (
    <div className="space-y-4">
      {/* Toast Notification */}
      {toast && (
        <div 
          className={`fixed bottom-5 left-5 z-50 text-xs font-bold px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 border transition-all animate-bounce-subtle ${
            toast.type === 'warning'
              ? 'bg-amber-50 text-amber-900 border-amber-300 shadow-amber-900/10'
              : 'bg-slate-900 text-white border-slate-700 shadow-slate-900/20'
          }`}
        >
          {toast.type === 'warning' ? (
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {/* Main Shortages Header & Direct Add Card */}
      <div className="no-print bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        {/* Top Header Row */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center border border-amber-500/20">
                <ClipboardList className="w-5 h-5" />
              </div>
              <h2 className="font-bold text-lg text-slate-900 flex items-center gap-2">
                <span>قائمة النواقص</span>
              </h2>
              <span className="bg-amber-100 text-amber-900 text-xs font-bold px-2.5 py-0.5 rounded-full border border-amber-200">
                {activeShortages.length} صنف مطلوب
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              تسجيل ومتابعة الأصناف الناقصة المطلوب شراؤها وتجهيزها من تجار الجملة والمطابع.
            </p>
          </div>

          {/* Action Buttons: Print, WhatsApp, Clear All, View Toggle */}
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
            <button
              onClick={() => {
                soundFx.playClick();
                setGroupByCategory(!groupByCategory);
              }}
              className={`text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5 border transition-colors cursor-pointer ${
                groupByCategory
                  ? 'bg-amber-50 text-amber-900 border-amber-300'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
              }`}
              title="تبديل طريقة العرض"
            >
              <Layers className="w-4 h-4 text-amber-600" />
              <span>{groupByCategory ? 'مقسم حسب المجموعات' : 'قائمة متصلة'}</span>
            </button>

            <button
              onClick={handleOpenPrintModal}
              disabled={activeShortages.length === 0}
              className={`text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer ${
                activeShortages.length > 0
                  ? 'bg-slate-900 hover:bg-slate-800 text-white'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
              title="تخصيص المجموعات المراد طباعتها واستثناء أي قسم"
            >
              <Printer className="w-4 h-4 text-emerald-400" />
              <span>تخصيص وطباعة A4</span>
            </button>

            <a
              href={`https://wa.me/?text=${encodeURIComponent(
                generateShortagesWhatsAppText(activeShortages, db.settings.shop || 'نظام إدارة المبيعات')
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => soundFx.playClick()}
              className="bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold px-3 py-2 rounded-xl flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" />
              <span>مشاركة واتساب</span>
            </a>

            {activeShortages.length > 0 && (
              <button
                onClick={() => {
                  if (!isOwner) {
                    soundFx.playWarning();
                    showToast({
                      text: '🔒 مسح النواقص متاح فقط لصاحب المتجر برمز الدخول السري',
                      type: 'warning'
                    });
                    onOpenOwnerModal?.();
                    return;
                  }
                  soundFx.playWarning();
                  setConfirmDeleteAllOpen(true);
                }}
                className={`text-xs ${
                  isOwner 
                    ? 'text-rose-600 hover:bg-rose-50 border-rose-300' 
                    : 'text-slate-600 bg-slate-100 hover:bg-slate-200 border-slate-300'
                } border font-bold px-3 py-2 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs`}
                title={isOwner ? "مسح وتفريغ قائمة النواقص بالكامل" : "خاص بالمالك فقط"}
              >
                {isOwner ? <Trash2 className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5 text-amber-600" />}
                <span>مسح كل النواقص {isOwner ? '' : '(للمالك)'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Direct Add Bar: Instant addition straight to shortages list */}
        <form onSubmit={handleQuickAdd} className="bg-slate-50 p-3 sm:p-3.5 rounded-xl border border-slate-200/80">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            {/* Item Name Input with Datalist */}
            <div className="relative flex-1">
              <input
                type="text"
                list="direct-products-datalist"
                required
                value={inputName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="اكتب اسم الصنف الناقص لإضافته فوراً لقائمة النواقص..."
                className="w-full bg-white border border-slate-300 focus:border-amber-500 rounded-xl py-2.5 px-3.5 text-xs sm:text-sm font-semibold outline-none transition-all placeholder:text-slate-400"
              />
              <datalist id="direct-products-datalist">
                {productDatalistOptions}
              </datalist>
            </div>

            {/* Category Selector */}
            <div className="w-full sm:w-44">
              <select
                value={inputCategory}
                onChange={(e) => setInputCategory(e.target.value)}
                className="w-full bg-white border border-slate-300 focus:border-amber-500 rounded-xl py-2.5 px-2.5 text-xs font-semibold outline-none transition-all text-slate-700"
              >
                <option value="">(المجموعة تلقائياً)</option>
                {allCategories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Quantity Stepper */}
            <div className="flex items-center justify-between sm:justify-start gap-1 bg-white border border-slate-300 rounded-xl px-2 py-1 shrink-0">
              <span className="text-[11px] font-bold text-slate-500 ml-1">الكمية:</span>
              <button
                type="button"
                onClick={() => {
                  soundFx.playClick();
                  setInputQty(prev => Math.max(1, prev - 1));
                }}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm cursor-pointer"
              >
                -
              </button>
              <input
                type="number"
                min="1"
                value={inputQty}
                onChange={(e) => setInputQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-12 text-center text-xs font-black bg-transparent outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  soundFx.playClick();
                  setInputQty(prev => prev + 1);
                }}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm cursor-pointer"
              >
                +
              </button>
            </div>

            {/* Notes Input Box */}
            <div className="w-full sm:w-52">
              <input
                type="text"
                value={inputNotes}
                onChange={(e) => setInputNotes(e.target.value)}
                placeholder="ملحوظة على الصنف (اختياري)..."
                className="w-full bg-white border border-slate-300 focus:border-amber-500 rounded-xl py-2.5 px-3 text-xs font-semibold outline-none transition-all placeholder:text-slate-400"
                title="مربع ملحوظات (مثلاً: أزرق، 80 ورقة، ماركة معينة)"
              />
            </div>

            {/* Add Button */}
            <button
              type="submit"
              className="bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-bold text-xs sm:text-sm px-5 py-2.5 rounded-xl shadow-sm transition-all flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة للنواقص</span>
            </button>
          </div>
        </form>

        {/* Search within shortages */}
        {activeShortages.length > 0 && (
          <div className="relative pt-1">
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="ابحث في قائمة النواقص بالاسم أو المجموعة..."
              className="w-full bg-slate-50 border border-slate-200 focus:border-amber-500 rounded-xl py-2 px-9 text-xs outline-none"
            />
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3.5 pointer-events-none" />
            {searchFilter && (
              <button
                onClick={() => {
                  soundFx.playClick();
                  setSearchFilter('');
                }}
                className="absolute left-3 top-2 text-xs text-slate-400 hover:text-slate-600 px-2 py-0.5 rounded cursor-pointer"
              >
                مسح
              </button>
            )}
          </div>
        )}
      </div>

      {/* Shortages List Content */}
      <div className="no-print bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        {activeShortages.length > 0 ? (
          groupByCategory ? (
            /* Grouped View by Category */
            <div className="space-y-6">
              {groupedActiveShortages.map(([catName, items]) => (
                <div key={catName} className="space-y-2">
                  {/* Category Header */}
                  <div className="flex items-center justify-between pb-1.5 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-800">📁 {catName}</span>
                      <span className="text-xs text-slate-500 font-semibold">
                        · {items.length} صنف · {items.reduce((s, i) => s + (Number(i.quantity) || 1), 0)} قطعة
                      </span>
                    </div>
                  </div>

                  {/* Structured Table Header (Desktop - Quantity & Item Name only, no serial clutter) */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="hidden md:grid md:grid-cols-[128px_minmax(0,1fr)_auto] items-center text-xs font-extrabold border-b border-slate-200 bg-slate-100 text-slate-700">
                      <div className="py-2 px-2 text-center bg-amber-100 text-amber-950 border-l border-slate-200">الكمية</div>
                      <div className="py-2 px-3 border-l border-slate-200">اسم الصنف والملاحظة</div>
                      <div className="py-2 px-3 text-center w-48">ملاحظة سريعة / حذف</div>
                    </div>

                    <div className="divide-y divide-slate-200">
                      {items.map((item, idx) => (
                        <div
                          key={item.id}
                          className={`perf-item flex flex-col md:grid md:grid-cols-[128px_minmax(0,1fr)_auto] items-stretch transition-colors ${
                            idx % 2 === 1 ? 'bg-slate-50/90' : 'bg-white'
                          } hover:bg-emerald-50/30`}
                        >
                          {/* Mobile header strip: Quantity badge + Date */}
                          <div className="flex items-center justify-between gap-2 p-2.5 md:hidden border-b border-slate-100 bg-slate-50/70">
                            <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-lg bg-amber-100 border border-amber-300 text-amber-950 font-black text-xs tabular-nums">
                              الكمية: {item.quantity}
                            </span>
                            <span className="text-[11px] text-slate-400">{new Date(item.date).toLocaleDateString('ar-EG')}</span>
                          </div>

                          {/* 2. Quantity Column (Desktop - Warm Amber Gold) */}
                          <div className="hidden md:flex items-center justify-center bg-amber-50/90 border-l border-slate-200 py-2 px-1.5">
                            <div className="flex items-center border border-amber-300 rounded-lg bg-white overflow-hidden shadow-2xs">
                              <button
                                type="button"
                                onClick={() => {
                                  soundFx.playClick();
                                  const current = Math.max(1, Number(item.quantity) || 1);
                                  onUpdateShortageQuantity(item.id, Math.max(1, current - 1));
                                }}
                                className="w-6 h-7 flex items-center justify-center text-amber-900 hover:bg-amber-100 font-bold text-sm cursor-pointer select-none"
                                title="تقليل الكمية"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min="1"
                                max="9999"
                                value={item.quantity}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10);
                                  onUpdateShortageQuantity(item.id, isNaN(val) ? 1 : Math.max(1, val));
                                }}
                                className="w-11 text-center text-xs font-black text-amber-950 bg-amber-50/50 outline-none border-x border-amber-200 py-1 focus:bg-amber-100 tabular-nums"
                                title="اضغط لكتابة العدد المطلوب مباشرة"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  soundFx.playClick();
                                  const current = Math.max(1, Number(item.quantity) || 1);
                                  onUpdateShortageQuantity(item.id, current + 1);
                                }}
                                className="w-6 h-7 flex items-center justify-center text-amber-900 hover:bg-amber-100 font-bold text-sm cursor-pointer select-none"
                                title="زيادة الكمية"
                              >
                                +
                              </button>
                            </div>
                          </div>

                          {/* 3. Item Name & Notes Column */}
                          <div className="min-w-0 flex flex-col justify-center py-2.5 px-3 md:border-l md:border-slate-200">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-sm sm:text-base text-slate-900 leading-snug">
                                {item.name}
                              </span>
                              {item.notes && (
                                <span className="font-black text-sm sm:text-base text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg inline-flex items-center">
                                  ({item.notes})
                                </span>
                              )}
                            </div>
                            <span className="hidden md:inline text-[11px] text-slate-400 mt-0.5">
                              {new Date(item.date).toLocaleDateString('ar-EG')}
                            </span>
                          </div>

                          {/* 4. Actions: Quick Note Edit, Mobile Stepper & Delete */}
                          <div className="flex items-center justify-between md:justify-end gap-1.5 px-3 pb-2.5 md:py-2.5 shrink-0">
                            {/* Mobile Stepper */}
                            <div className="flex md:hidden items-center border border-amber-300 rounded-lg bg-white overflow-hidden">
                              <button
                                type="button"
                                onClick={() => {
                                  soundFx.playClick();
                                  const current = Math.max(1, Number(item.quantity) || 1);
                                  onUpdateShortageQuantity(item.id, Math.max(1, current - 1));
                                }}
                                className="w-7 h-7 flex items-center justify-center text-amber-900 hover:bg-amber-50 font-bold text-sm cursor-pointer select-none"
                                title="تقليل الكمية"
                              >
                                -
                              </button>
                              <input
                                type="number"
                                min="1"
                                max="9999"
                                value={item.quantity}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10);
                                  onUpdateShortageQuantity(item.id, isNaN(val) ? 1 : Math.max(1, val));
                                }}
                                className="w-11 text-center text-xs font-black text-amber-950 bg-amber-50/40 outline-none border-x border-amber-200 py-1 tabular-nums"
                                title="اضغط لكتابة العدد المطلوب مباشرة"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  soundFx.playClick();
                                  const current = Math.max(1, Number(item.quantity) || 1);
                                  onUpdateShortageQuantity(item.id, current + 1);
                                }}
                                className="w-7 h-7 flex items-center justify-center text-amber-900 hover:bg-amber-50 font-bold text-sm cursor-pointer select-none"
                                title="زيادة الكمية"
                              >
                                +
                              </button>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                defaultValue={item.notes || ''}
                                key={`note-grp-${item.id}-${item.notes || ''}`}
                                onBlur={(e) => {
                                  const val = e.target.value.trim();
                                  if (val !== (item.notes || '')) {
                                    onUpdateShortageNotes?.(item.id, val);
                                    showToast(`تم حفظ ملحوظة «${item.name}»`);
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }}
                                placeholder="ملحوظة على الصنف..."
                                className="w-28 sm:w-36 bg-white border border-slate-300 focus:border-amber-500 rounded-lg py-1 px-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 outline-none transition-colors"
                                title="اكتب ملحوظة على هذا الصنف (اضغط Enter للحفظ)"
                              />
                              <button
                                onClick={() => {
                                  if (!isOwner) {
                                    soundFx.playWarning();
                                    showToast({
                                      text: '🔒 حذف الصنف متاح فقط للمالك برمز الدخول السري',
                                      type: 'warning'
                                    });
                                    onOpenOwnerModal?.();
                                    return;
                                  }
                                  soundFx.playWarning();
                                  setPendingDeleteShortage(item);
                                }}
                                className="text-slate-400 hover:text-rose-600 p-1.5 rounded transition-colors cursor-pointer"
                                title={isOwner ? "حذف من النواقص" : "حذف الصنف (خاص بالمالك فقط)"}
                              >
                                {isOwner ? <Trash2 className="w-4 h-4" /> : <Lock className="w-3.5 h-3.5 text-slate-400" />}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Flat Connected List: Quantity -> Item Name (no serial clutter) */
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="hidden md:grid md:grid-cols-[128px_minmax(0,1fr)_auto] items-center text-xs font-extrabold border-b border-slate-200 bg-slate-100 text-slate-700">
                <div className="py-2 px-2 text-center bg-amber-100 text-amber-950 border-l border-slate-200">الكمية</div>
                <div className="py-2 px-3 border-l border-slate-200">اسم الصنف والملاحظة</div>
                <div className="py-2 px-3 text-center w-48">ملاحظة سريعة / حذف</div>
              </div>

              <div className="divide-y divide-slate-200">
                {activeShortages.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`perf-item flex flex-col md:grid md:grid-cols-[128px_minmax(0,1fr)_auto] items-stretch transition-colors ${
                      idx % 2 === 1 ? 'bg-slate-50/90' : 'bg-white'
                    } hover:bg-emerald-50/30`}
                  >
                    {/* Mobile header strip */}
                    <div className="flex items-center justify-between gap-2 p-2.5 md:hidden border-b border-slate-100 bg-slate-50/70">
                      <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-lg bg-amber-100 border border-amber-300 text-amber-950 font-black text-xs tabular-nums">
                        الكمية: {item.quantity}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500">{item.category || 'بدون مجموعة'}</span>
                    </div>

                    {/* 2. Quantity Column (Amber Gold) */}
                    <div className="hidden md:flex items-center justify-center bg-amber-50/90 border-l border-slate-200 py-2 px-1.5">
                      <div className="flex items-center border border-amber-300 rounded-lg bg-white overflow-hidden shadow-2xs">
                        <button
                          type="button"
                          onClick={() => {
                            soundFx.playClick();
                            const current = Math.max(1, Number(item.quantity) || 1);
                            onUpdateShortageQuantity(item.id, Math.max(1, current - 1));
                          }}
                          className="w-6 h-7 flex items-center justify-center text-amber-900 hover:bg-amber-100 font-bold text-sm cursor-pointer select-none"
                          title="تقليل الكمية"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="1"
                          max="9999"
                          value={item.quantity}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            onUpdateShortageQuantity(item.id, isNaN(val) ? 1 : Math.max(1, val));
                          }}
                          className="w-11 text-center text-xs font-black text-amber-950 bg-amber-50/50 outline-none border-x border-amber-200 py-1 focus:bg-amber-100 tabular-nums"
                          title="اضغط لكتابة العدد المطلوب مباشرة"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            soundFx.playClick();
                            const current = Math.max(1, Number(item.quantity) || 1);
                            onUpdateShortageQuantity(item.id, current + 1);
                          }}
                          className="w-6 h-7 flex items-center justify-center text-amber-900 hover:bg-amber-100 font-bold text-sm cursor-pointer select-none"
                          title="زيادة الكمية"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* 3. Item Name & Notes Column */}
                    <div className="min-w-0 flex flex-col justify-center py-2.5 px-3 md:border-l md:border-slate-200">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-sm sm:text-base text-slate-900 leading-snug">
                          {item.name}
                        </span>
                        {item.notes && (
                          <span className="font-black text-sm sm:text-base text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg inline-flex items-center">
                            ({item.notes})
                          </span>
                        )}
                      </div>
                      <div className="hidden md:flex text-[11px] text-slate-400 mt-0.5 items-center gap-2">
                        <span>{item.category || 'بدون مجموعة'}</span>
                        <span>·</span>
                        <span>{new Date(item.date).toLocaleDateString('ar-EG')}</span>
                      </div>
                    </div>

                    {/* 4. Actions */}
                    <div className="flex items-center justify-between md:justify-end gap-1.5 px-3 pb-2.5 md:py-2.5 shrink-0">
                      <div className="flex md:hidden items-center border border-amber-300 rounded-lg bg-white overflow-hidden">
                        <button
                          type="button"
                          onClick={() => {
                            soundFx.playClick();
                            const current = Math.max(1, Number(item.quantity) || 1);
                            onUpdateShortageQuantity(item.id, Math.max(1, current - 1));
                          }}
                          className="w-7 h-7 flex items-center justify-center text-amber-900 hover:bg-amber-50 font-bold text-sm cursor-pointer select-none"
                          title="تقليل الكمية"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="1"
                          max="9999"
                          value={item.quantity}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            onUpdateShortageQuantity(item.id, isNaN(val) ? 1 : Math.max(1, val));
                          }}
                          className="w-11 text-center text-xs font-black text-amber-950 bg-amber-50/40 outline-none border-x border-amber-200 py-1 tabular-nums"
                          title="اضغط لكتابة العدد المطلوب مباشرة"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            soundFx.playClick();
                            const current = Math.max(1, Number(item.quantity) || 1);
                            onUpdateShortageQuantity(item.id, current + 1);
                          }}
                          className="w-7 h-7 flex items-center justify-center text-amber-900 hover:bg-amber-50 font-bold text-sm cursor-pointer select-none"
                          title="زيادة الكمية"
                        >
                          +
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          defaultValue={item.notes || ''}
                          key={`note-flat-${item.id}-${item.notes || ''}`}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val !== (item.notes || '')) {
                              onUpdateShortageNotes?.(item.id, val);
                              showToast(`تم حفظ ملحوظة «${item.name}»`);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          placeholder="ملحوظة على الصنف..."
                          className="w-28 sm:w-36 bg-white border border-slate-300 focus:border-amber-500 rounded-lg py-1 px-2 text-xs font-medium text-slate-800 placeholder:text-slate-400 outline-none transition-colors"
                          title="اكتب ملحوظة على هذا الصنف (اضغط Enter للحفظ)"
                        />
                        <button
                          onClick={() => {
                            if (!isOwner) {
                              soundFx.playWarning();
                              showToast({
                                text: '🔒 حذف الصنف متاح فقط للمالك برمز الدخول السري',
                                type: 'warning'
                              });
                              onOpenOwnerModal?.();
                              return;
                            }
                            soundFx.playWarning();
                            setPendingDeleteShortage(item);
                          }}
                          className="text-slate-400 hover:text-rose-600 p-1.5 rounded transition-colors cursor-pointer"
                          title={isOwner ? "حذف" : "حذف الصنف (خاص بالمالك فقط)"}
                        >
                          {isOwner ? <Trash2 className="w-4 h-4" /> : <Lock className="w-3.5 h-3.5 text-slate-400" />}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          /* Empty State */
          <div className="py-12 text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-slate-800 text-sm">
              قائمة النواقص فارغة حالياً
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              ممتاز! كل الأصناف متوفرة. يمكنك إضافة أي صنف ناقص من مربع الإضافة أعلاه أو بالضغط على زر «نواقص» بجانب أي صنف في النظام.
            </p>
          </div>
        )}
      </div>

      {/* Print Customizer Modal */}
      {isPrintModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto no-print">
          <div className="bg-white rounded-2xl max-w-xl w-full p-5 sm:p-6 shadow-2xl space-y-4 my-8 border border-slate-100">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="p-2 bg-slate-100 rounded-xl text-slate-900">
                  <Printer className="w-5 h-5 text-emerald-600" />
                </span>
                <div>
                  <h3 className="font-black text-slate-900 text-base">تخصيص وطباعة كشف النواقص</h3>
                  <p className="text-xs text-slate-500">اختر المجموعات المطلوب طباعتها واستثنِ أي قسم لا تريده</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPrintModalOpen(false)}
                aria-label="إغلاق نافذة الطباعة"
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Filter Actions */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleSelectAllCategories}
                className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                ✓ تحديد كل المجموعات
              </button>
              <button
                type="button"
                onClick={handleExcludeAccessories}
                className="text-xs bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                title="استثناء أقسام الإكسسوارات الحريمي والمحمول"
              >
                <span>🚫 استثناء الإكسسوارات</span>
              </button>
              <button
                type="button"
                onClick={handleDeselectAllCategories}
                className="text-xs text-rose-600 hover:bg-rose-50 font-bold px-2 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                إلغاء التحديد
              </button>
            </div>

            {/* Category Checkboxes List */}
            <div className="space-y-1.5 max-h-56 overflow-y-auto p-1 border border-slate-200 rounded-xl bg-slate-50/50">
              {activeCategoriesSummary.map((cat) => {
                const isSelected = selectedCategoriesForPrint.includes(cat.name);
                return (
                  <label
                    key={cat.name}
                    className={`flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-white border-emerald-400 shadow-2xs text-slate-900'
                        : 'bg-slate-50/80 border-slate-200 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleCategoryPrint(cat.name)}
                        className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                      />
                      <span className="font-bold text-xs sm:text-sm">
                        📁 {cat.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full ${
                        isSelected ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-500'
                      }`}>
                        {cat.count} صنف مطلوب
                      </span>
                      {!isSelected && (
                        <span className="text-[10px] text-rose-500 font-bold">
                          (مستثنى من الطباعة)
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>

            {/* Layout Style Choice */}
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPrintFormat('compact')}
                  className={`p-2.5 rounded-xl border text-right font-bold transition-all cursor-pointer ${
                    printFormat === 'compact'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-900 shadow-xs'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="font-black">📑 كشف مضغوط في صفحة واحدة A4</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">خط كبير وواضح بدون مسلسل أو مجموعات ({compactLayout.columns} {compactLayout.columns === 1 ? 'عمود' : compactLayout.columns === 2 ? 'عمودين' : 'أعمدة'})</div>
                </button>

                <button
                  type="button"
                  onClick={() => setPrintFormat('grouped')}
                  className={`p-2.5 rounded-xl border text-right font-bold transition-all cursor-pointer ${
                    printFormat === 'grouped'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-900 shadow-xs'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="font-black">📋 كشف مفصل حسب المجموعات</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">توزيع الأصناف داخل عناوين أقسامها</div>
                </button>
              </div>

              {printFormat === 'compact' && (
                <div className="flex flex-wrap items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl p-2">
                  <span className="text-[11px] font-bold text-slate-600 ml-1">توزيع الأعمدة:</span>
                  {([
                    { value: 'auto', label: `تلقائي (${compactLayout.columns} ${compactLayout.columns === 1 ? 'عمود' : compactLayout.columns === 2 ? 'عمودين' : 'أعمدة'})` },
                    { value: 2, label: 'عمودين' },
                    { value: 3, label: '3 أعمدة' },
                    { value: 4, label: '4 أعمدة' }
                  ] as const).map((opt) => (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => setPrintColsPref(opt.value)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                        printColsPref === opt.value
                          ? 'bg-slate-900 text-white'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selection Status Summary */}
            <div className="p-3 bg-slate-100 rounded-xl text-xs font-bold text-slate-700 flex items-center justify-between">
              <div>
                <span>الملخص: </span>
                <span className="text-emerald-700 font-black">
                  سيتم تضمين {printFilteredShortages.length} صنف من أصل {activeShortages.length}
                </span>
                {activeCategoriesSummary.length - selectedCategoriesForPrint.length > 0 && (
                  <span className="text-slate-500 mr-1">
                    (تم استبعاد {activeCategoriesSummary.length - selectedCategoriesForPrint.length} مجموعة)
                  </span>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsPrintModalOpen(false)}
                className="w-full sm:w-auto bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-4 py-2.5 rounded-xl text-xs transition-colors cursor-pointer"
              >
                إلغاء
              </button>

              <a
                href={`https://wa.me/?text=${encodeURIComponent(
                  generateShortagesWhatsAppText(printFilteredShortages, db.settings.shop || 'نظام إدارة المبيعات')
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => soundFx.playClick()}
                className={`w-full sm:w-auto bg-teal-600 hover:bg-teal-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  printFilteredShortages.length === 0 ? 'opacity-50 pointer-events-none' : ''
                }`}
              >
                <MessageCircle className="w-4 h-4" />
                <span>واتساب للمجموعات المحددة</span>
              </a>

              <button
                type="button"
                onClick={() => {
                  if (printFilteredShortages.length === 0) {
                    showToast({ text: 'يرجى تحديد مجموعة واحدة على الأقل للطباعة', type: 'warning' });
                    return;
                  }
                  handleExecutePrint();
                }}
                disabled={printFilteredShortages.length === 0}
                className={`w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white font-black px-6 py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 shadow-md transition-colors cursor-pointer ${
                  printFilteredShortages.length === 0 ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                <Printer className="w-4 h-4 text-emerald-400" />
                <span>🖨️ بدء الطباعة الآن (A4)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Shortages Sheet (Single-Page A4 Adaptive 1-4 Columns, Large Font, No Serial / No Done / No Category Clutter) */}
      {isPrintModalOpen && (() => {
        const printCount = printFilteredShortages.length;
        const isFew = printCount <= 12;
        const isModerate = printCount > 12 && printCount <= 30;
        const isCompactChrome = compactLayout.isCompactChrome;

        const sheetPadding = printFormat === 'compact'
          ? (isCompactChrome ? 'p-1.5' : 'p-4')
          : (isFew ? 'p-6' : 'p-3');
        const headerSpacing = printFormat === 'compact' && isCompactChrome
          ? 'pb-1.5 mb-2'
          : isFew
          ? 'pb-4 mb-4'
          : 'pb-2.5 mb-2.5';
        const shopTitleSize = printFormat === 'compact' && isCompactChrome
          ? 'text-lg'
          : isFew
          ? 'text-2xl'
          : 'text-xl';
        const badgeTitleSize = printFormat === 'compact' && isCompactChrome
          ? 'text-sm'
          : isFew
          ? 'text-xl'
          : 'text-base';

        const cellPad = isFew ? 'py-2.5 px-3' : isModerate ? 'py-1.5 px-2.5' : 'py-1 px-2';
        const headPad = isFew ? 'py-2 px-3' : isModerate ? 'py-1.5 px-2.5' : 'py-1 px-2';
        const itemTextClass = isFew ? 'text-[13.5pt]' : isModerate ? 'text-[11.5pt]' : 'text-[9.5pt]';
        const noteTextClass = isFew ? 'text-[12.5pt]' : isModerate ? 'text-[10.5pt]' : 'text-[9pt]';
        const qtyTextClass = isFew ? 'text-[14pt]' : isModerate ? 'text-[12pt]' : 'text-[10pt]';
        const groupHeaderTextClass = isFew
          ? 'text-sm px-4 py-1.5'
          : isModerate
          ? 'text-xs px-3 py-1'
          : 'text-[10pt] px-2.5 py-0.5';

        return (
          <div id="printable-shortages-sheet" className={`${sheetPadding} font-sans text-slate-900 bg-white`}>
            {/* Header */}
            <div className={`${headerSpacing} border-b-2 border-slate-900 flex justify-between items-center gap-3`}>
              <div className="space-y-0.5">
                <h1 className={`${shopTitleSize} font-black tracking-tight text-slate-900`}>
                  {db.settings.shop || 'مكتبة الطيب أحسن'}
                </h1>
                {!isCompactChrome && (
                  <p className="text-xs text-slate-600 font-bold">
                    {db.settings.tagline || 'للأدوات المكتبية والمدرسية والخدمات الطلابية'}
                  </p>
                )}
                {db.settings.phone && (
                  <p className={`${isCompactChrome ? 'text-[10px]' : 'text-xs'} font-mono font-bold text-slate-800`}>
                    هاتف / واتساب: {db.settings.phone}
                  </p>
                )}
              </div>

              <div className={`text-center border-2 border-slate-900 ${isCompactChrome ? 'px-4 py-1' : 'px-5 py-2'} rounded-xl bg-slate-50`}>
                <span className={`font-black ${badgeTitleSize} block text-slate-900`}>كشف طلبيات ونواقص بضاعة</span>
                {!isCompactChrome && (
                  <span className="text-[10px] text-slate-600 font-bold">نسخة التوريد وتجار الجملة والمطابع</span>
                )}
              </div>

              <div className={`text-left font-mono ${isCompactChrome ? 'text-[10px] px-2.5 py-1' : 'text-xs p-2.5'} border border-slate-300 bg-slate-50 rounded-xl leading-snug`}>
                <div><strong>التاريخ:</strong> {new Date().toLocaleDateString('ar-EG')}</div>
                <div><strong>الأصناف:</strong> <span className="font-black text-slate-900">{printFilteredShortages.length} صنف مطلوب</span></div>
              </div>
            </div>

            {/* Shortages Content */}
            {printFormat === 'grouped' ? (
              /* Grouped Tables by Category (Quantity -> Item Name only) */
              <div className={isFew ? 'space-y-5' : isModerate ? 'space-y-3' : 'space-y-2'}>
                {printGroupedShortages.map(([catName, itemsInCat]) => (
                  <div key={catName} className="print-avoid-break">
                    <div className={`bg-slate-200 border border-slate-900 text-slate-900 font-black flex justify-between items-center rounded-t-lg ${groupHeaderTextClass}`}>
                      <span>📁 {catName}</span>
                      <span className="font-mono">({itemsInCat.length} صنف)</span>
                    </div>
                    <table className="print-table w-full text-right border-collapse border border-slate-900">
                      <thead>
                        <tr className={`border-b border-slate-900 font-bold text-slate-900 ${isFew ? 'text-sm' : 'text-xs'}`}>
                          <th className={`${headPad} w-20 text-center border-l border-slate-900 bg-amber-200 text-amber-950`}>الكمية</th>
                          <th className={`${headPad} bg-slate-100 text-slate-900`}>اسم الصنف المطلوب</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-400">
                        {itemsInCat.map((item, idx) => (
                          <tr key={item.id} className={idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'}>
                            <td className={`${cellPad} text-center font-mono font-black text-amber-950 bg-amber-100/90 border-l border-slate-400 tabular-nums ${qtyTextClass}`}>
                              {item.quantity}
                            </td>
                            <td className={`${cellPad} font-bold text-slate-900 ${itemTextClass}`}>
                              <span>{item.name}</span>
                              {item.notes && (
                                <span className={`font-black text-emerald-900 mr-1.5 ${noteTextClass}`}>
                                  ({item.notes})
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ) : (
              /* Adaptive 1-4 Column Single-Page Layout (Quantity -> Item Name only, zero category/serial/checkbox clutter) */
              <div className={`grid ${compactLayout.gridColsClass} ${compactLayout.gapClass} items-start`}>
                {printMultiColumns.map((col, colIdx) => (
                  <table key={colIdx} className={`print-table w-full text-right border-collapse border border-slate-900 ${compactLayout.fontSizeClass}`}>
                    <thead>
                      <tr className="border-b border-slate-900 font-bold text-slate-900">
                        <th className={`${compactLayout.headPadClass} ${compactLayout.qtyColWidthClass} text-center border-l border-slate-900 bg-amber-200 text-amber-950 whitespace-nowrap`}>
                          الكمية
                        </th>
                        <th className={`${compactLayout.headPadClass} bg-slate-100 text-slate-900`}>
                          اسم الصنف
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-400">
                      {col.map((item, idx) => (
                        <tr key={item.id} className={idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'}>
                          <td className={`${compactLayout.cellPadClass} text-center font-mono font-black text-amber-950 bg-amber-100/90 border-l border-slate-400 tabular-nums ${compactLayout.qtySizeClass}`}>
                            {item.quantity}
                          </td>
                          <td className={`${compactLayout.cellPadClass} font-bold text-slate-900`}>
                            <span>{item.name}</span>
                            {item.notes && (
                              <span className={`font-black text-emerald-900 mr-1 ${compactLayout.noteSizeClass}`}>
                                ({item.notes})
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              </div>
            )}

            {/* Slim Footer */}
            <div className={`${isCompactChrome ? 'mt-2 pt-1.5 text-[9pt]' : isFew ? 'mt-8 pt-4 text-sm' : 'mt-4 pt-2 text-xs'} border-t-2 border-slate-900 flex justify-between items-center text-slate-700 print-avoid-break`}>
              <div>توقيع المستلم: ...........................</div>
              <div className="text-center font-bold text-slate-900">
                {db.settings.shop || 'مكتبة الطيب أحسن'} — كشف طلبيات معتمد
              </div>
              <div>توقيع المورّد: ...........................</div>
            </div>
          </div>
        );
      })()}

      {/* Confirm Delete Single Shortage */}
      <ConfirmModal
        isOpen={Boolean(pendingDeleteShortage)}
        title="حذف صنف من قائمة النواقص"
        description={`هل تريد حذف «${pendingDeleteShortage?.name || ''}»؟ سيُنقل إلى سلة المهملات لمدة 30 يوماً ويمكن استرجاعه في أي وقت.`}
        confirmLabel="نعم، حذف الصنف"
        isDestructive={true}
        onConfirm={() => {
          if (pendingDeleteShortage) {
            soundFx.playRemove();
            onDeleteShortage(pendingDeleteShortage.id);
            showToast(`تم نقل «${pendingDeleteShortage.name}» إلى سلة المهملات`);
            setPendingDeleteShortage(null);
          }
        }}
        onCancel={() => setPendingDeleteShortage(null)}
      />

      {/* Confirm Delete All Shortages */}
      <ConfirmModal
        isOpen={confirmDeleteAllOpen}
        title="مسح وتفريغ قائمة النواقص بالكامل"
        description={`هل أنت متأكد من نقل جميع الأصناف المسجلة في قائمة النواقص (${activeShortages.length} صنف) إلى سلة المهملات؟`}
        confirmLabel="نعم، مسح كل النواقص"
        isDestructive={true}
        onConfirm={() => {
          onDeleteAllShortages();
          setConfirmDeleteAllOpen(false);
          soundFx.playSuccess();
          showToast('تم نقل جميع النواقص إلى سلة المهملات (يُحفظ لمدة 30 يوماً)');
        }}
        onCancel={() => setConfirmDeleteAllOpen(false)}
      />
    </div>
  );
};
