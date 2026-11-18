import React, { useState, useCallback } from 'react';
import { ArrowDownAZ, ArrowUpDown, ArrowUpNarrowWide, ArrowDownWideNarrow, CalendarClock, CircleDollarSign } from 'lucide-react';
import {
  getDefaultSortDirection,
  PRODUCT_SORT_STORAGE_KEY,
  ProductSortField,
  SortDirection,
} from '../utils/shopLogic';
import { soundFx } from '../utils/audioFeedback';

export interface ProductSortState {
  field: ProductSortField;
  direction: SortDirection;
}

export function useProductSort(storageKey: string = PRODUCT_SORT_STORAGE_KEY) {
  const [sortState, setSortState] = useState<ProductSortState>(() => {
    if (typeof window === 'undefined') {
      return { field: 'name', direction: 'asc' };
    }
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ProductSortState>;
        const validField: ProductSortField =
          parsed.field === 'createdAt' || parsed.field === 'price' || parsed.field === 'name'
            ? parsed.field
            : 'name';
        const validDir: SortDirection =
          parsed.direction === 'asc' || parsed.direction === 'desc'
            ? parsed.direction
            : getDefaultSortDirection(validField);
        return { field: validField, direction: validDir };
      }
    } catch {
      // ignore storage errors
    }
    return { field: 'name', direction: 'asc' };
  });

  const persist = useCallback(
    (next: ProductSortState) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
    },
    [storageKey]
  );

  const selectSortField = useCallback(
    (field: ProductSortField) => {
      soundFx.playClick();
      setSortState((prev) => {
        const next: ProductSortState =
          prev.field === field
            ? { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
            : { field, direction: getDefaultSortDirection(field) };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const toggleDirection = useCallback(() => {
    soundFx.playClick();
    setSortState((prev) => {
      const next: ProductSortState = {
        ...prev,
        direction: prev.direction === 'asc' ? 'desc' : 'asc',
      };
      persist(next);
      return next;
    });
  }, [persist]);

  return {
    sortField: sortState.field,
    sortDirection: sortState.direction,
    selectSortField,
    toggleDirection,
  };
}

interface ProductSortBarProps {
  sortField: ProductSortField;
  sortDirection: SortDirection;
  onSelectField: (field: ProductSortField) => void;
  onToggleDirection: () => void;
  compact?: boolean;
  accent?: 'emerald' | 'indigo' | 'blue';
}

export const ProductSortBar: React.FC<ProductSortBarProps> = ({
  sortField,
  sortDirection,
  onSelectField,
  onToggleDirection,
  compact = false,
  accent = 'emerald',
}) => {
  const activeBg =
    accent === 'indigo'
      ? 'bg-indigo-600 text-white shadow-xs'
      : accent === 'blue'
      ? 'bg-blue-600 text-white shadow-xs'
      : 'bg-slate-900 text-white shadow-xs';

  const getDirectionLabel = (): string => {
    if (sortField === 'createdAt') {
      return sortDirection === 'desc' ? 'الأحدث أولاً' : 'الأقدم أولاً';
    }
    if (sortField === 'price') {
      return sortDirection === 'asc' ? 'الأقل سعراً' : 'الأعلى سعراً';
    }
    return sortDirection === 'asc' ? 'أ ← ي' : 'ي ← أ';
  };

  const options: { id: ProductSortField; label: string; icon: React.ReactNode }[] = [
    { id: 'name', label: 'الاسم (أبجدي)', icon: <ArrowDownAZ className="w-3.5 h-3.5" /> },
    { id: 'createdAt', label: 'تاريخ الإضافة', icon: <CalendarClock className="w-3.5 h-3.5" /> },
    { id: 'price', label: 'السعر', icon: <CircleDollarSign className="w-3.5 h-3.5" /> },
  ];

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${
        compact ? 'text-[11px]' : 'text-xs'
      }`}
      role="group"
      aria-label="تصنيف وترتيب الأصناف"
    >
      <span className="inline-flex items-center gap-1 text-slate-500 font-bold ml-0.5 shrink-0">
        <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
        <span>ترتيب الأصناف:</span>
      </span>

      <div className="inline-flex flex-wrap items-center bg-slate-100 p-1 rounded-xl gap-1 border border-slate-200/80">
        {options.map((opt) => {
          const isActive = sortField === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelectField(opt.id)}
              aria-pressed={isActive}
              data-sort-field={opt.id}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer whitespace-nowrap ${
                isActive
                  ? activeBg
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
              }`}
              title={`ترتيب الأصناف حسب ${opt.label}`}
            >
              {opt.icon}
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onToggleDirection}
        data-testid="sort-direction-toggle"
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold transition-colors cursor-pointer whitespace-nowrap shadow-2xs"
        title="عكس اتجاه الترتيب"
      >
        {sortDirection === 'asc' ? (
          <ArrowUpNarrowWide className="w-3.5 h-3.5 text-emerald-600" />
        ) : (
          <ArrowDownWideNarrow className="w-3.5 h-3.5 text-amber-600" />
        )}
        <span>{getDirectionLabel()}</span>
      </button>
    </div>
  );
};
