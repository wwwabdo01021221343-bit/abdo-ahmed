import React, { useEffect } from 'react';
import { X, Tag, ZoomIn } from 'lucide-react';
import { formatCurrency } from '../utils/shopLogic';

interface ImageModalProps {
  isOpen: boolean;
  imageUrl: string;
  title: string;
  category?: string;
  price?: number;
  onClose: () => void;
}

export const ImageModal: React.FC<ImageModalProps> = ({
  isOpen,
  imageUrl,
  title,
  category,
  price,
  onClose
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !imageUrl) return null;

  return (
    <div 
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto no-print animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl space-y-0 my-6 relative border border-slate-700/30"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3.5 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg shrink-0">
              <ZoomIn className="w-4 h-4" />
            </span>
            <div className="truncate">
              <h3 className="font-black text-slate-900 text-sm truncate">{title}</h3>
              {category && (
                <span className="text-[11px] text-slate-500 font-semibold">{category}</span>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-200 transition-colors cursor-pointer shrink-0"
            title="إغلاق المعاينة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* High-Resolution Image Container */}
        <div className="bg-slate-900 flex items-center justify-center p-2 min-h-[260px] max-h-[65vh] overflow-hidden">
          <img
            src={imageUrl}
            alt={title}
            className="w-auto h-auto max-w-full max-h-[62vh] object-contain rounded-lg shadow-inner select-none"
          />
        </div>

        {/* Footer with details */}
        <div className="p-3.5 bg-white flex items-center justify-between border-t border-slate-100">
          <div>
            {category && (
              <span className="bg-slate-100 text-slate-700 text-xs font-bold px-2.5 py-1 rounded-lg">
                📁 {category}
              </span>
            )}
          </div>

          {price != null && (
            <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1 rounded-xl">
              <Tag className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-xs font-bold">سعر البيع:</span>
              <span className="text-sm font-black text-emerald-700 font-mono">
                {formatCurrency(price)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
