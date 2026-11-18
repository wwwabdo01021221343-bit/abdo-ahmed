import React, { useState } from 'react';
import { 
  Package, 
  Receipt, 
  AlertTriangle, 
  TrendingUp, 
  ShoppingCart, 
  Printer, 
  FolderPlus, 
  Tag, 
  Cloud,
  Clock,
  ExternalLink,
  ShieldCheck,
  ClipboardList,
  Sparkles,
  Lock,
  RefreshCw,
  CheckCircle2,
  WifiOff
} from 'lucide-react';
import { AppDatabase, Product, Invoice } from '../types';
import { formatCurrency, calculateDailySales, formatDateTime } from '../utils/shopLogic';
import { formatLastUpdatedLabel } from '../utils/syncLogic';
import { SyncStatusState } from '../services/offlineSync';
import { CloudAuthStatus } from '../services/firebase';
import { StartupSyncRefreshResult } from './StartupSyncSplash';
import { soundFx } from '../utils/audioFeedback';

interface DashboardProps {
  db: AppDatabase;
  onNavigate: (tab: string) => void;
  onAddToCart: (product: Product) => void;
  onAddToShortage: (product: Product) => { added: boolean; message: string };
  onOpenInvoiceModal: (invoice: Invoice) => void;
  isOwner?: boolean;
  onOpenOwnerModal?: () => void;
  syncStatus?: SyncStatusState;
  cloudAuthStatus?: CloudAuthStatus;
  onManualRefresh?: () => Promise<StartupSyncRefreshResult>;
}

export const Dashboard: React.FC<DashboardProps> = ({
  db,
  onNavigate,
  onOpenInvoiceModal,
  isOwner = false,
  onOpenOwnerModal,
  syncStatus,
  cloudAuthStatus,
  onManualRefresh,
}) => {
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'warning' } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  React.useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const lastUpdatedInfo = formatLastUpdatedLabel(syncStatus?.lastSyncAt, nowTick);

  const handleManualRefreshClick = async () => {
    if (!onManualRefresh || isRefreshing) return;
    soundFx.playClick();
    setIsRefreshing(true);
    try {
      const res = await onManualRefresh();
      setNowTick(Date.now());
      if (res.outcome === 'synced') {
        soundFx.playSuccess();
        setToast({
          text: `تم التحديث من السحابة بنجاح (${res.productCount} صنف · ${res.invoiceCount} فاتورة)`,
          type: 'success',
        });
      } else if (res.outcome === 'offline') {
        soundFx.playWarning();
        setToast({
          text: 'أنت بدون إنترنت حالياً — يتم استخدام آخر نسخة محفوظة محلياً',
          type: 'warning',
        });
      } else if (res.outcome === 'unauthenticated') {
        setToast({
          text: 'تعذر إتمام التحديث السحابي حالياً — ستتم إعادة المحاولة تلقائياً',
          type: 'warning',
        });
      } else {
        setToast({
          text: res.message || 'تعذر الاتصال بالسحابة حالياً — ستستمر المحاولة تلقائياً',
          type: 'warning',
        });
      }
      setTimeout(() => setToast(null), 3500);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Metrics
  const totalProducts = db.products.length;
  const todaySales = calculateDailySales(db.invoices);
  const activeShortages = db.shortages.length;
  const totalCategories = new Set(db.products.map(p => (p.category || 'بدون مجموعة').trim())).size;

  // Recent invoices (last 5)
  const recentInvoices = [...db.invoices]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Sync Status & Last Updated Timestamp Bar */}
      <div
        data-testid="dashboard-last-updated-bar"
        className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              syncStatus && !syncStatus.isOnline
                ? 'bg-amber-50 text-amber-600'
                : 'bg-emerald-50 text-emerald-600'
            }`}
          >
            {syncStatus && !syncStatus.isOnline ? (
              <WifiOff className="w-5 h-5" />
            ) : (
              <CheckCircle2 className="w-5 h-5" />
            )}
          </div>
          <div className="min-w-0 text-xs leading-relaxed">
            <div className="font-bold text-slate-900 flex flex-wrap items-center gap-1.5">
              <span>آخر تحديث:</span>
              <span className="text-emerald-700 font-black">{lastUpdatedInfo.primary}</span>
            </div>
            <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
              <span>
                {syncStatus && !syncStatus.isOnline
                  ? 'وضع أوفلاين نشط'
                  : cloudAuthStatus === 'authorized'
                  ? 'متصل بالسحابة (حساب المالك)'
                  : 'متصل بالسحابة (مزامنة تلقائية للأجهزة)'}
              </span>
              {syncStatus && syncStatus.pendingCount > 0 && (
                <>
                  <span>·</span>
                  <span className="font-bold text-amber-700">
                    {syncStatus.pendingCount} تعديل بانتظار الرفع
                  </span>
                </>
              )}
              {lastUpdatedInfo.hasSyncedBefore && (
                <>
                  <span>·</span>
                  <span className="font-mono text-slate-500">{lastUpdatedInfo.exact}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {onManualRefresh && (
          <button
            type="button"
            disabled={isRefreshing || Boolean(syncStatus?.isSyncing)}
            onClick={handleManualRefreshClick}
            className="min-h-[44px] bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white font-bold text-xs px-4 py-2 rounded-xl transition-all flex items-center justify-center gap-2 shrink-0 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw
              className={`w-4 h-4 ${
                isRefreshing || syncStatus?.isSyncing ? 'animate-spin motion-reduce:animate-none' : ''
              }`}
            />
            <span>{isRefreshing || syncStatus?.isSyncing ? 'جاري التحديث...' : 'تحديث ومزامنة الآن'}</span>
          </button>
        )}
      </div>

      {/* 6 Prominent Colorful Main Action Cards */}
      <div>
        <div className="flex items-center justify-between mb-3.5 px-1">
          <h2 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-600" />
            <span>لوحة التحكم الرئيسية والوصول السريع</span>
          </h2>
          <span className="text-xs text-slate-500 font-semibold">
            اضغط على أي قسم للدخول الفوري
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {/* Card 1: كشف ودليل الأسعار (عرض السعر فقط بدون تعديل) */}
          <button
            onClick={() => {
              soundFx.playClick();
              onNavigate('price-check');
            }}
            className="group relative overflow-hidden bg-gradient-to-br from-indigo-700 via-indigo-800 to-violet-900 hover:from-indigo-600 hover:to-violet-800 text-white p-5 rounded-2xl shadow-sm text-right flex flex-col justify-between transition-all duration-200 active:scale-[0.98] cursor-pointer border border-indigo-500/30 min-h-[140px]"
          >
            <div className="flex items-start justify-between">
              <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-xs flex items-center justify-center text-white border border-white/20 group-hover:scale-110 transition-transform">
                <Tag className="w-6 h-6 text-indigo-200" />
              </div>
              <span className="text-[10px] bg-indigo-500/40 text-indigo-100 font-bold px-2.5 py-1 rounded-full border border-indigo-400/40 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-indigo-300" />
                <span>عرض آمن بدون تعديل</span>
              </span>
            </div>
            <div>
              <div className="font-black text-base sm:text-lg tracking-tight">كشف ودليل الأسعار</div>
              <div className="text-xs text-indigo-200 mt-1 font-medium leading-relaxed">
                معرفة سعر البيع فوراً للزبائن دون تعديل أو حذف بالخطأ ({totalProducts} صنف)
              </div>
            </div>
          </button>

          {/* Card 2: الفواتير ونقطة البيع (الكاشير) */}
          <button
            onClick={() => {
              soundFx.playClick();
              onNavigate('pos');
            }}
            className="group relative overflow-hidden bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 hover:from-emerald-500 hover:to-teal-700 text-white p-5 rounded-2xl shadow-sm text-right flex flex-col justify-between transition-all duration-200 active:scale-[0.98] cursor-pointer border border-emerald-500/30 min-h-[140px]"
          >
            <div className="flex items-start justify-between">
              <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-xs flex items-center justify-center text-white border border-white/20 group-hover:scale-110 transition-transform">
                <ShoppingCart className="w-6 h-6 text-emerald-200" />
              </div>
              <span className="text-[10px] bg-emerald-500/40 text-emerald-100 font-bold px-2.5 py-1 rounded-full border border-emerald-400/40 font-mono">
                مبيعات اليوم: {formatCurrency(todaySales)}
              </span>
            </div>
            <div>
              <div className="font-black text-base sm:text-lg tracking-tight">الفواتير ونقطة البيع (الكاشير)</div>
              <div className="text-xs text-emerald-100 mt-1 font-medium leading-relaxed">
                إنشاء فواتير سريعة، حساب الإجمالي، وطباعة إيصالات احترافية
              </div>
            </div>
          </button>

          {/* Card 3: دفتر النواقص */}
          <button
            onClick={() => {
              soundFx.playClick();
              onNavigate('shortages');
            }}
            className="group relative overflow-hidden bg-gradient-to-br from-amber-500 via-amber-600 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white p-5 rounded-2xl shadow-sm text-right flex flex-col justify-between transition-all duration-200 active:scale-[0.98] cursor-pointer border border-amber-400/30 min-h-[140px]"
          >
            <div className="flex items-start justify-between">
              <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-xs flex items-center justify-center text-white border border-white/20 group-hover:scale-110 transition-transform">
                <ClipboardList className="w-6 h-6 text-amber-100" />
              </div>
              <span className="text-[10px] bg-amber-400/30 text-white font-black px-2.5 py-1 rounded-full border border-amber-300/40">
                {activeShortages} صنف مطلوب
              </span>
            </div>
            <div>
              <div className="font-black text-base sm:text-lg tracking-tight">دفتر النواقص</div>
              <div className="text-xs text-amber-100 mt-1 font-medium leading-relaxed">
                متابعة الأصناف الناقصة للشراء بالجملة، طباعتها ومشاركتها
              </div>
            </div>
          </button>

          {/* Card 4: النسخ الاحتياطي بأنواعه (محلي + Google Drive) */}
          <button
            onClick={() => {
              soundFx.playClick();
              onNavigate('settings');
            }}
            className="group relative overflow-hidden bg-gradient-to-br from-teal-700 via-cyan-800 to-blue-900 hover:from-teal-600 hover:to-blue-800 text-white p-5 rounded-2xl shadow-sm text-right flex flex-col justify-between transition-all duration-200 active:scale-[0.98] cursor-pointer border border-teal-500/30 min-h-[140px]"
          >
            <div className="flex items-start justify-between">
              <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-xs flex items-center justify-center text-white border border-white/20 group-hover:scale-110 transition-transform">
                <Cloud className="w-6 h-6 text-teal-200" />
              </div>
              <span className="text-[10px] bg-teal-500/40 text-teal-100 font-bold px-2.5 py-1 rounded-full border border-teal-400/40">
                نسخ يومية + سلة 30 يوم
              </span>
            </div>
            <div>
              <div className="font-black text-base sm:text-lg tracking-tight">النسخ الاحتياطي والمزامنة</div>
              <div className="text-xs text-teal-100 mt-1 font-medium leading-relaxed">
                النسخ السحابية اليومية التلقائية، سلة المهملات (30 يوماً)، وGoogle Drive
              </div>
            </div>
          </button>

          {/* Card 5: إدارة وتعديل الأصناف (إضافة صنف جديد) */}
          <button
            onClick={() => {
              soundFx.playClick();
              onNavigate('products');
            }}
            className="group relative overflow-hidden bg-gradient-to-br from-slate-800 via-slate-900 to-indigo-950 hover:from-slate-700 hover:to-indigo-900 text-white p-5 rounded-2xl shadow-sm text-right flex flex-col justify-between transition-all duration-200 active:scale-[0.98] cursor-pointer border border-slate-700 min-h-[140px]"
          >
            <div className="flex items-start justify-between">
              <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-xs flex items-center justify-center text-white border border-white/20 group-hover:scale-110 transition-transform">
                <FolderPlus className="w-6 h-6 text-slate-200" />
              </div>
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border flex items-center gap-1 ${
                isOwner 
                  ? 'bg-amber-500/30 text-amber-200 border-amber-400/40' 
                  : 'bg-slate-700 text-slate-300 border-slate-600'
              }`}>
                {isOwner ? (
                  <>
                    <ShieldCheck className="w-3 h-3 text-amber-300" />
                    <span>صاحب المتجر (كامل الصلاحيات)</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-3 h-3 text-amber-400" />
                    <span>{totalCategories} مجموعات (تعديل مقفل)</span>
                  </>
                )}
              </span>
            </div>
            <div>
              <div className="font-black text-base sm:text-lg tracking-tight">إدارة وتعديل الأصناف</div>
              <div className="text-xs text-slate-300 mt-1 font-medium leading-relaxed">
                {isOwner
                  ? 'إضافة صنف جديد، وتعديل الأسعار والمجموعات، مع مزامنة سحابية تلقائية فورية'
                  : 'استعراض الأصناف وإضافة أصناف جديدة سحابياً (تعديل الأسعار والحذف للمالك)'}
              </div>
            </div>
          </button>

          {/* Card 6: طباعة الأصناف والكتالوج بتصنيفاتها */}
          <button
            onClick={() => {
              soundFx.playClick();
              onNavigate('print');
            }}
            className="group relative overflow-hidden bg-gradient-to-br from-blue-600 via-sky-700 to-indigo-800 hover:from-blue-500 hover:to-indigo-700 text-white p-5 rounded-2xl shadow-sm text-right flex flex-col justify-between transition-all duration-200 active:scale-[0.98] cursor-pointer border border-blue-400/30 min-h-[140px]"
          >
            <div className="flex items-start justify-between">
              <div className="w-12 h-12 rounded-xl bg-white/15 backdrop-blur-xs flex items-center justify-center text-white border border-white/20 group-hover:scale-110 transition-transform">
                <Printer className="w-6 h-6 text-sky-200" />
              </div>
              <span className="text-[10px] bg-sky-500/40 text-sky-100 font-bold px-2.5 py-1 rounded-full border border-sky-400/40">
                ورق A4 موفر
              </span>
            </div>
            <div>
              <div className="font-black text-base sm:text-lg tracking-tight">طباعة كتالوج الأصناف</div>
              <div className="text-xs text-sky-100 mt-1 font-medium leading-relaxed">
                طباعة كامل الأصناف والأسعار مقسمة حسب التصنيفات بصيغة جاهزة للطباعة
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Products */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block mb-1">عدد الأصناف</span>
            <span className="text-2xl font-black text-slate-900">{totalProducts}</span>
            <span className="text-xs text-slate-400 block mt-0.5">{totalCategories} مجموعات</span>
          </div>
          <div className="w-11 h-11 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <Package className="w-5 h-5" />
          </div>
        </div>

        {/* Today's Sales */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block mb-1">مبيعات اليوم</span>
            <span className="text-2xl font-black text-emerald-600">{formatCurrency(todaySales)}</span>
            <span className="text-xs text-emerald-700/80 block mt-0.5">من فواتير اليوم</span>
          </div>
          <div className="w-11 h-11 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        {/* Active Shortages */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block mb-1">النواقص المطلوبة</span>
            <span className="text-2xl font-black text-amber-600">{activeShortages}</span>
            <span className="text-xs text-slate-400 block mt-0.5">صنف بحاجة للتوريد</span>
          </div>
          <div className="w-11 h-11 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        {/* Invoices Count */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 block mb-1">إجمالي الفواتير</span>
            <span className="text-2xl font-black text-slate-900">{db.invoices.length}</span>
            <span className="text-xs text-slate-400 block mt-0.5">مسجلة في النظام</span>
          </div>
          <div className="w-11 h-11 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
            <Receipt className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Recent Invoices Section */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-slate-500" />
            <h2 className="text-base font-bold text-slate-900">أحدث الفواتير الصادرة</h2>
          </div>
          <button
            onClick={() => {
              soundFx.playClick();
              onNavigate('pos');
            }}
            className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer"
          >
            <span>عرض كل الفواتير</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>

        {recentInvoices.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {recentInvoices.map((inv) => (
              <div
                key={inv.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/60 px-2 rounded-lg transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-900 text-sm">
                      #{inv.id}
                    </span>
                    {inv.customer ? (
                      <span className="text-xs text-slate-700 font-semibold">
                        العميل: {inv.customer}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">عميل نقدي</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                    <span>{formatDateTime(inv.date)}</span>
                    <span>·</span>
                    <span>{inv.items.length} أصناف</span>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3">
                  <span className="font-black text-emerald-600 text-sm">
                    {formatCurrency(inv.total)}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        soundFx.playClick();
                        onOpenInvoiceModal(inv);
                        onNavigate('pos');
                      }}
                      className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                    >
                      معاينة وطباعة
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-slate-400 text-sm">
            لم تسجل فواتير بعد. ابدأ بعمل أول فاتورة من زر «الفواتير ونقطة البيع».
          </div>
        )}
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
    </div>
  );
};
