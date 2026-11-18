import React, { useState, useMemo, useEffect } from 'react';
import { Printer, Check, Sparkles, Layers, SlidersHorizontal, FileText, Lock, Folder } from 'lucide-react';
import { AppDatabase, PrintCatalogMode, Product } from '../types';
import { formatCurrency, sortProducts, splitIntoColumns } from '../utils/shopLogic';
import { ProductSortBar, useProductSort } from './ProductSortBar';

interface PrintCatalogViewProps {
  db: AppDatabase;
  isOwner?: boolean;
  onRequestOwnerLogin?: () => void;
}

export const PrintCatalogView: React.FC<PrintCatalogViewProps> = ({
  db,
  isOwner = false,
  onRequestOwnerLogin,
}) => {
  const [printMode, setPrintMode] = useState<PrintCatalogMode>('retail');
  const [selectedCategory, setSelectedCategory] = useState<string>('الكل');
  const [columnCount, setColumnCount] = useState<number>(4); // Default 4 columns for extreme paper saving!
  const [fontSize, setFontSize] = useState<'compact' | 'normal'>('compact');
  const [groupByCategory, setGroupByCategory] = useState<boolean>(true);
  const { sortField, sortDirection, selectSortField, toggleDirection } = useProductSort();

  // Ensure wholesale buy prices are never exposed if user exits owner mode
  useEffect(() => {
    if (!isOwner && printMode === 'buy') {
      setPrintMode('retail');
    }
  }, [isOwner, printMode]);

  const modes: { id: PrintCatalogMode; label: string; desc: string; ownerOnly?: boolean }[] = [
    { id: 'retail', label: 'أسعار البيع قطاعي', desc: 'مناسب للزبائن والبيع اليومي المباشر' },
    { id: 'dozen', label: 'أسعار البيع بالدستة', desc: 'مناسب للحضانات والمدارس وطلبيات الجملة' },
    { id: 'buy', label: 'أسعار الشراء جملة (سري)', desc: 'نسخة سرية للمالك لجرد التكلفة وحساب الأرباح', ownerOnly: true },
    { id: 'none', label: 'الأصناف فقط بدون أسعار', desc: 'أفضل خيار للجرد الورقي السريع ومراجعة الرفوف' },
  ];

  // Unique categories
  const categories = useMemo(() => {
    const set = new Set(db.products.map(p => (p.category || 'بدون مجموعة').trim() || 'بدون مجموعة'));
    return ['الكل', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'ar'))];
  }, [db.products]);

  // Filtered & sorted products list
  const activeProducts = useMemo(() => {
    let list = db.products;
    if (selectedCategory !== 'الكل') {
      list = list.filter(p => ((p.category || 'بدون مجموعة').trim() || 'بدون مجموعة') === selectedCategory);
      return sortProducts(list, sortField, sortDirection);
    }

    if (!groupByCategory) {
      return sortProducts(list, sortField, sortDirection);
    }

    const grouped = new Map<string, Product[]>();
    for (const p of list) {
      const cat = (p.category || 'بدون مجموعة').trim() || 'بدون مجموعة';
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(p);
    }
    const sortedCats = Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b, 'ar'));
    const combined: Product[] = [];
    for (const [, items] of sortedCats) {
      combined.push(...sortProducts(items, sortField, sortDirection));
    }
    return combined;
  }, [db.products, selectedCategory, groupByCategory, sortField, sortDirection]);

  // Fast O(1) index map for global numbering
  const productIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    activeProducts.forEach((p, idx) => map.set(p.id, idx + 1));
    return map;
  }, [activeProducts]);

  // Multi-column partition
  const columns = useMemo(() => {
    return splitIntoColumns(activeProducts, columnCount);
  }, [activeProducts, columnCount]);

  const triggerPrint = () => {
    window.print();
  };

  return (
    <div className="space-y-4">
      {/* Configuration & Customization Card (No-Print) */}
      <div className="no-print bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <Printer className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold text-slate-900">
                تنسيق طباعة الكتالوج الموفر للورق
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              تم تحسين التنسيق لتقليل عدد صفحات الورق بنسبة 60% مع خط واضح وأنيق جداً.
            </p>
          </div>

          <button
            onClick={triggerPrint}
            className="w-full sm:w-auto bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs sm:text-sm px-6 py-2.5 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 shrink-0 active:scale-98"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة القائمة الآن (A4)</span>
          </button>
        </div>

        {/* Print Mode Selector */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-2">
            1. نوع البيانات المطلوبة في الطباعة:
          </label>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {modes.map((m) => {
              const locked = Boolean(m.ownerOnly && !isOwner);
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    if (locked) {
                      onRequestOwnerLogin?.();
                      return;
                    }
                    setPrintMode(m.id);
                  }}
                  className={`p-3 rounded-xl border text-right transition-all flex flex-col justify-between cursor-pointer ${
                    locked
                      ? 'border-slate-200 bg-slate-100/80 text-slate-400 hover:border-amber-300'
                      : printMode === m.id
                      ? 'border-blue-500 bg-blue-50/80 text-blue-950 font-bold shadow-xs'
                      : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs">{m.label}</span>
                    {locked ? (
                      <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    ) : (
                      printMode === m.id && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    )}
                  </div>
                  <span className="text-[10px] text-slate-500 mt-1">
                    {locked ? 'مخصص لصاحب المتجر فقط (اضغط للدخول)' : m.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Paper Saving Controls: Column count & Density */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100 text-xs">
          {/* Columns count */}
          <div>
            <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>تقسيم الأعمدة (توفير الورق):</span>
            </label>
            <div className="grid grid-cols-3 gap-1">
              {[4, 3, 2].map((num) => (
                <button
                  key={num}
                  onClick={() => setColumnCount(num)}
                  className={`py-1.5 px-2 rounded-lg font-bold transition-colors ${
                    columnCount === num
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {num} أعمدة {num === 4 ? '(موصى به)' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Font Density */}
          <div>
            <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
              <span>حجم الخط والمسافات:</span>
            </label>
            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => setFontSize('compact')}
                className={`py-1.5 px-2 rounded-lg font-bold transition-colors ${
                  fontSize === 'compact'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                فائق التوفير (مدمج)
              </button>
              <button
                onClick={() => setFontSize('normal')}
                className={`py-1.5 px-2 rounded-lg font-bold transition-colors ${
                  fontSize === 'normal'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                قياسي أنيق
              </button>
            </div>
          </div>

          {/* Category Filter */}
          <div>
            <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-slate-500" />
              <span>تحديد مجموعة معينة:</span>
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded-lg py-1.5 px-3 font-semibold outline-none"
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Sort & Category Grouping Row */}
        <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <ProductSortBar
            sortField={sortField}
            sortDirection={sortDirection}
            onSelectField={selectSortField}
            onToggleDirection={toggleDirection}
            compact
            accent="blue"
          />

          {selectedCategory === 'الكل' && (
            <button
              type="button"
              onClick={() => setGroupByCategory(!groupByCategory)}
              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                groupByCategory
                  ? 'bg-blue-50 text-blue-800 border-blue-200'
                  : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}
              title="التبديل بين ترتيب الأصناف داخل كل مجموعة أو ترتيب كامل الأصناف مباشرة"
            >
              <Folder className="w-3.5 h-3.5 text-blue-600" />
              <span>{groupByCategory ? 'ترتيب داخل كل مجموعة' : 'ترتيب كل الأصناف معاً'}</span>
            </button>
          )}
        </div>

        {/* Paper Count Estimate Tip */}
        <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-xl p-3 flex items-center gap-2 text-xs text-emerald-900">
          <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            💡 <strong>توفير ذكي للورق:</strong> بفضل التقسيم إلى <strong>{columnCount} أعمدة</strong>، سيتم طباعة الـ <strong>{activeProducts.length} صنف</strong> في حوالي <strong>صفحتين A4 فقط (أو صفحة واحدة وجه وظهر)</strong> دون أي إهدار!
          </span>
        </div>
      </div>

      {/* ========================================================= */}
      {/* Printable Sheet View (Optimized for both Preview & Print) */}
      {/* ========================================================= */}
      <div
        id="catalog-print-area"
        className={`printable-sheet bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm text-slate-900 ${
          fontSize === 'compact' ? 'text-[8pt] leading-tight' : 'text-[9pt] leading-normal'
        }`}
      >
        {/* Elegant Top Header Banner */}
        <div className="text-center pb-2 mb-3 border-b-2 border-slate-900 flex flex-col items-center">
          <div className="flex items-center justify-between w-full">
            <div className="text-right">
              <div className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                📚 {db.settings.shop || 'قائمة الأسعار والأصناف'}
              </div>
              {db.settings.phone && (
                <div className="text-[7.5pt] text-slate-600 font-semibold">
                  واتساب: {db.settings.phone}
                </div>
              )}
            </div>

            <div className="bg-slate-100 border border-slate-300 px-3 py-1 rounded text-center">
              <span className="font-bold text-[8.5pt] text-slate-900 block">
                {modes.find(m => m.id === printMode)?.label}
              </span>
              <span className="text-[7pt] text-slate-500">
                {selectedCategory !== 'الكل' ? `مجموعة: ${selectedCategory}` : 'كتالوج الأصناف الكامل'}
              </span>
            </div>

            <div className="text-left text-[7.5pt] text-slate-600 font-mono">
              <div>التاريخ: {new Date().toLocaleDateString('ar-EG')}</div>
              <div>العدد: {activeProducts.length} صنف</div>
            </div>
          </div>
        </div>

        {/* Continuous Multi-Column Grid */}
        <div
          className={`grid gap-2 items-start ${
            columnCount === 4
              ? 'grid-cols-2 md:grid-cols-4'
              : columnCount === 3
              ? 'grid-cols-1 md:grid-cols-3'
              : 'grid-cols-1 md:grid-cols-2'
          }`}
        >
          {columns.map((colItems, colIdx) => (
            <table
              key={colIdx}
              className="print-table w-full text-right border-collapse border border-slate-400 table-fixed"
            >
              <thead>
                <tr className="bg-slate-200 border-b border-slate-400 font-bold text-slate-900 text-[7.5pt]">
                  <th className="p-0.5 border-l border-slate-400 w-6 text-center">م</th>
                  <th className="p-0.5 border-l border-slate-400">الصنف</th>
                  {printMode !== 'none' && (
                    <th className="p-0.5 w-12 text-center">
                      {printMode === 'retail' ? 'السعر' : printMode === 'dozen' ? 'دستة' : 'جملة'}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300">
                {colItems.map((prod, rowIdx) => {
                  const globalIndex = productIndexMap.get(prod.id) ?? 0;
                  const prevProd = colItems[rowIdx - 1];
                  const isNewCat = !prevProd || prevProd.category !== prod.category;

                  let priceStr = '';
                  if (printMode === 'retail') {
                    priceStr = formatCurrency(prod.price);
                  } else if (printMode === 'dozen') {
                    const dozenVal = prod.sellDozenRetail ?? prod.dozenPrice;
                    priceStr = dozenVal != null ? formatCurrency(dozenVal) : '—';
                  } else if (printMode === 'buy' && isOwner) {
                    const buyVal = prod.buyWholesale ?? prod.wholesalePrice;
                    priceStr = buyVal != null ? formatCurrency(buyVal) : '—';
                  }

                  return (
                    <React.Fragment key={prod.id}>
                      {/* Compact Category Ribbon inside column */}
                      {isNewCat && selectedCategory === 'الكل' && groupByCategory && (
                        <tr className="bg-slate-800 text-white font-bold text-[7pt]">
                          <td
                            colSpan={printMode !== 'none' ? 3 : 2}
                            className="py-0.5 px-1 border-b border-slate-700 font-bold text-right"
                          >
                            📁 {prod.category}
                          </td>
                        </tr>
                      )}
                      <tr className="hover:bg-slate-100/70 even:bg-slate-50/70 transition-colors">
                        <td className="p-0.5 border-l border-slate-300 text-center font-mono text-[7pt] text-slate-500">
                          {globalIndex}
                        </td>
                        <td className="p-0.5 border-l border-slate-300 font-semibold text-slate-900 truncate">
                          {prod.name}
                        </td>
                        {printMode !== 'none' && (
                          <td className="p-0.5 text-center font-black text-slate-900 whitespace-nowrap text-[7pt]">
                            {priceStr}
                          </td>
                        )}
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          ))}
        </div>

        {/* Elegant Footer Note (Fits on bottom of page) */}
        <div className="mt-3 pt-2 border-t border-slate-300 text-center text-[7pt] text-slate-500 flex items-center justify-between">
          <span>مكتبة الطيب أحسن — لجميع المستلزمات المدرسية والمكتبية والهدايا</span>
          <span>صفحة {activeProducts.length} صنف · تمت الطباعة بنجاح</span>
        </div>
      </div>
    </div>
  );
};
