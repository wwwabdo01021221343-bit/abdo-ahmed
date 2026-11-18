import React from 'react';
import { WifiOff, RefreshCw, CheckCircle2, Download } from 'lucide-react';
import { useSyncStatus, flushOfflineOutbox } from '../services/offlineSync';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallBanner: React.FC = () => {
  const syncStatus = useSyncStatus();
  const { isInstallable, isInstalled, isIOS, installPWA } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = React.useState(false);

  return (
    <div className="no-print">
      {/* 1. Offline Status Alert */}
      {!syncStatus.isOnline && (
        <div
          role="status"
          className="bg-amber-600 text-white px-4 py-2.5 text-xs font-bold flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow"
        >
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>
              أنت الآن بدون إنترنت (أوفلاين) — جميع الإضافات والفواتير والنواقص تُحفظ فوراً على جهازك وستُرفع تلقائياً فور عودة الاتصال.
            </span>
          </div>
          <span className="bg-amber-900/60 px-2.5 py-1 rounded-lg text-[11px] shrink-0 self-start sm:self-auto">
            {syncStatus.pendingCount > 0 ? `${syncStatus.pendingCount} تعديل بانتظار الرفع` : 'وضع الأوفلاين'}
          </span>
        </div>
      )}

      {/* 2. Reconnected & Syncing / Retry Banner */}
      {syncStatus.isOnline && (syncStatus.isSyncing || syncStatus.pendingCount > 0) && (
        <div
          role="status"
          className="bg-sky-700 text-white px-4 py-2 text-xs font-bold flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow"
        >
          <div className="flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 shrink-0 ${syncStatus.isSyncing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
            <span>
              {syncStatus.isSyncing
                ? `عاد الاتصال — جاري رفع ومزامنة التغييرات المعلقة (${syncStatus.pendingCount})...`
                : syncStatus.lastError
                ? `${syncStatus.lastError} (${syncStatus.pendingCount})`
                : `يوجد ${syncStatus.pendingCount} تعديل بانتظار المزامنة مع السحابة`}
            </span>
          </div>
          <button
            type="button"
            onClick={() => flushOfflineOutbox(true, true)}
            className="bg-sky-900/80 hover:bg-sky-950 px-3.5 py-1.5 min-h-[36px] rounded-lg text-[11px] cursor-pointer shrink-0 self-start sm:self-auto"
          >
            مزامنة الآن
          </button>
        </div>
      )}

      {/* 3. Sync Completed Confirmation Toast */}
      {syncStatus.isOnline && !syncStatus.isSyncing && syncStatus.pendingCount === 0 && syncStatus.justSyncedCount > 0 && (
        <div
          role="status"
          className="bg-emerald-600 text-white px-4 py-2 text-xs font-bold flex items-center justify-center gap-2 shadow"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>تمت مزامنة ورفع جميع التغييرات ({syncStatus.justSyncedCount}) مع السحابة بنجاح</span>
        </div>
      )}

      {/* 4. In-App PWA Install Prompt (when not installed & prompt is available) */}
      {!isInstalled && isInstallable && !isIOS && (
        <div className="bg-slate-800 text-slate-100 px-4 py-1.5 text-xs flex items-center justify-between gap-2 border-t border-slate-700">
          <span className="font-medium">ثبّت التطبيق على جهازك للعمل الفوري والسريع حتى بدون إنترنت</span>
          <button
            type="button"
            onClick={() => installPWA()}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1 rounded-lg text-[11px] flex items-center gap-1 cursor-pointer shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>تثبيت التطبيق</span>
          </button>
        </div>
      )}

      {!isInstalled && isIOS && showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl text-slate-900 space-y-3">
            <h3 className="text-base font-bold">تثبيت التطبيق على الآيفون والآيباد</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              1. اضغط على زر <strong>المشاركة (Share)</strong> في متصفح Safari.<br />
              2. اختر <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong>.
            </p>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full rounded-xl bg-slate-900 text-white py-2 text-xs font-bold cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
