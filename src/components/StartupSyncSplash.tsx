import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock,
  Cloud,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import { checkForAppUpdate } from '../utils/pwaUpdate';
import { formatLastUpdatedLabel, readLastSyncInfo } from '../utils/syncLogic';
import { soundFx } from '../utils/audioFeedback';

export type StartupRefreshOutcome =
  | 'synced'
  | 'offline'
  | 'unauthenticated'
  | 'error';

export interface StartupSyncRefreshResult {
  outcome: StartupRefreshOutcome;
  syncedAt: string | null;
  productCount: number;
  invoiceCount: number;
  shortageCount: number;
  appUpdated?: boolean;
  message?: string;
}

interface StartupSyncSplashProps {
  shopName: string;
  shopTagline?: string;
  initialProductCount: number;
  onRunStartupSync: () => Promise<StartupSyncRefreshResult>;
  onComplete: () => void;
}

export const StartupSyncSplash: React.FC<StartupSyncSplashProps> = ({
  shopName,
  shopTagline,
  initialProductCount,
  onRunStartupSync,
  onComplete,
}) => {
  const initialLastSync = readLastSyncInfo();

  const [progress, setProgress] = useState<number>(12);
  const [stageLabel, setStageLabel] = useState<string>('جاري فحص التحديثات وبدء التشغيل...');
  const [stageDetail, setStageDetail] = useState<string>('تهيئة البيانات وتحديث نسخة المتجر');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(initialLastSync.lastSyncAt);
  const [resultSummary, setResultSummary] = useState<StartupSyncRefreshResult | null>(null);
  const [isDone, setIsDone] = useState<boolean>(false);

  const startedRef = useRef<boolean>(false);
  const completedRef = useRef<boolean>(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressCreepRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef(onComplete);
  const onRunSyncRef = useRef(onRunStartupSync);

  onCompleteRef.current = onComplete;
  onRunSyncRef.current = onRunStartupSync;

  const stopTimers = () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    if (progressCreepRef.current) {
      clearInterval(progressCreepRef.current);
      progressCreepRef.current = null;
    }
  };

  const finishSplash = () => {
    if (completedRef.current) return;
    completedRef.current = true;
    stopTimers();
    onCompleteRef.current();
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;

    const run = async () => {
      setProgress(20);
      setStageLabel('فحص تحديثات التطبيق...');
      setStageDetail('التأكد من تشغيل أحدث إصدار متاح');

      const swResult = await checkForAppUpdate(2000);
      if (cancelled || completedRef.current) return;

      if (swResult === 'updated') {
        setStageLabel('تم تجهيز تحديث جديد للبرنامج');
      } else if (swResult === 'offline') {
        setStageLabel('وضع الأوفلاين نشط');
      }

      setProgress(48);
      setStageLabel('مزامنة التغييرات وجلب أحدث البيانات...');
      setStageDetail('تحديث الأصناف والأسعار والفواتير والنواقص من السحابة');

      // Gentle animated progress advancement while network pull runs
      progressCreepRef.current = setInterval(() => {
        setProgress((prev) => (prev < 88 ? Math.min(88, prev + 3) : prev));
      }, 280);

      let res: StartupSyncRefreshResult;
      try {
        res = await Promise.race([
          onRunSyncRef.current(),
          new Promise<StartupSyncRefreshResult>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  outcome: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error',
                  syncedAt: readLastSyncInfo().lastSyncAt,
                  productCount: initialProductCount,
                  invoiceCount: 0,
                  shortageCount: 0,
                  message: 'استغرقت الشبكة وقتاً أطول من المعتاد — تم التشغيل بالنسخة المحفوظة',
                }),
              7000
            )
          ),
        ]);
      } catch {
        res = {
          outcome: 'error',
          syncedAt: readLastSyncInfo().lastSyncAt,
          productCount: initialProductCount,
          invoiceCount: 0,
          shortageCount: 0,
          message: 'تم التشغيل بالبيانات المحفوظة محلياً',
        };
      }

      if (progressCreepRef.current) {
        clearInterval(progressCreepRef.current);
        progressCreepRef.current = null;
      }

      if (cancelled || completedRef.current) return;

      if (res.syncedAt) {
        setLastSyncAt(res.syncedAt);
      }
      setResultSummary(res);
      setProgress(100);

      if (res.outcome === 'synced') {
        setStageLabel('تم التحديث والمزامنة بنجاح');
        setStageDetail(
          `${res.productCount} صنف · ${res.invoiceCount} فاتورة · ${res.shortageCount} نواقص`
        );
      } else if (res.outcome === 'offline') {
        setStageLabel('جاهز للعمل في وضع الأوفلاين');
        setStageDetail('سيتم رفع أي تعديلات فور عودة الإنترنت تلقائياً');
      } else {
        setStageLabel('تم تجهيز بيانات المتجر بنجاح');
        setStageDetail(res.message || 'تم الفتح بالنسخة المحفوظة محلياً');
      }

      setIsDone(true);

      const autoCloseDelay = res.outcome === 'synced' ? 950 : 1450;
      dismissTimerRef.current = setTimeout(() => {
        finishSplash();
      }, autoCloseDelay);
    };

    void run();

    return () => {
      cancelled = true;
      stopTimers();
    };
  }, [initialProductCount]);

  const formattedLastSync = formatLastUpdatedLabel(lastSyncAt);
  const isOffline = resultSummary?.outcome === 'offline';

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="شاشة التحديث التلقائي عند فتح البرنامج"
      className="fixed inset-0 z-50 bg-gradient-to-br from-emerald-50 via-teal-50/80 to-sky-50 text-slate-900 flex flex-col justify-between p-4 sm:p-6 overflow-y-auto"
    >
      {/* Top Identity Row */}
      <header className="max-w-lg w-full mx-auto pt-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-sky-500 flex items-center justify-center shadow-md shadow-emerald-600/20 shrink-0">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-900">{shopName || 'مكتبة الطيب أحسن'}</h1>
            <p className="text-[11px] font-semibold text-teal-700">
              {shopTagline || 'نظام إدارة الأصناف والمبيعات'}
            </p>
          </div>
        </div>

        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>تشغيل آمن</span>
        </span>
      </header>

      {/* Center Card with Smooth Linear Progress Bar */}
      <main className="max-w-lg w-full mx-auto my-auto py-4">
        <div className="bg-white/95 backdrop-blur-md border border-emerald-200/80 rounded-3xl p-6 sm:p-7 shadow-xl shadow-teal-900/10 space-y-6">
          {/* Status Hero */}
          <div className="flex items-center gap-3.5">
            <div
              className={`w-14 h-14 rounded-2xl flex items-center justify-center border shrink-0 transition-colors ${
                isOffline
                  ? 'bg-amber-50 border-amber-200 text-amber-600'
                  : isDone
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                  : 'bg-gradient-to-br from-emerald-50 to-sky-50 border-teal-200 text-teal-600'
              }`}
            >
              {isOffline ? (
                <WifiOff className="w-7 h-7" />
              ) : isDone ? (
                <CheckCircle2 className="w-7 h-7" />
              ) : (
                <Cloud className="w-7 h-7" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-black text-slate-900 leading-snug">
                {!isDone
                  ? 'جاري تحديث المتجر تلقائياً...'
                  : resultSummary?.outcome === 'synced'
                  ? 'تم التحديث وأنت على أحدث نسخة'
                  : isOffline
                  ? 'جاهز للعمل في وضع الأوفلاين'
                  : 'تم تجهيز المتجر بنجاح'}
              </h2>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                {!isDone
                  ? 'يفحص التطبيق التحديثات ويجلب أحدث الأصناف والأسعار والفواتير بين أجهزتك'
                  : 'يمكنك الآن استخدام الكاشير والأصناف والنواقص مباشرة'}
              </p>
            </div>
          </div>

          {/* Sleek Animated Progress Bar ("خط التحميل") */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs gap-2">
              <span className="font-bold text-slate-800 flex items-center gap-1.5 min-w-0 truncate">
                <Sparkles
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isOffline ? 'text-amber-500' : 'text-emerald-600'
                  }`}
                />
                <span className="truncate">{stageLabel}</span>
              </span>
              <span className="font-mono font-black text-teal-700 tabular-nums shrink-0">
                {progress}%
              </span>
            </div>

            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label="نسبة التحديث والمزامنة"
              className="w-full h-3.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200/80 p-0.5 shadow-inner"
            >
              <div
                style={{ width: `${progress}%` }}
                className={`h-full rounded-full transition-all duration-300 ease-out relative overflow-hidden ${
                  isOffline
                    ? 'bg-gradient-to-l from-amber-400 via-amber-500 to-orange-500'
                    : isDone
                    ? 'bg-gradient-to-l from-emerald-500 via-teal-500 to-sky-500'
                    : 'bg-gradient-to-l from-emerald-500 via-teal-400 to-sky-500'
                }`}
              >
                {!isDone && (
                  <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/35 to-transparent animate-pulse motion-reduce:animate-none" />
                )}
              </div>
            </div>

            <div className="text-[11px] text-slate-500 font-medium leading-relaxed text-center">
              {stageDetail}
            </div>
          </div>

          {/* Last Updated Timestamp Box ("آخر تحديث تم إمتى") */}
          <div
            data-testid="startup-last-updated-box"
            className="bg-gradient-to-l from-emerald-50/90 via-teal-50/70 to-sky-50/80 border border-teal-200/80 rounded-2xl p-4 space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 font-bold text-teal-800">
                <Clock className="w-4 h-4 text-teal-600" />
                <span>آخر تحديث تم للبرنامج والبيانات</span>
              </span>
              {resultSummary?.outcome === 'synced' && (
                <span className="text-[11px] font-black text-emerald-700">مُحدّث الآن</span>
              )}
            </div>
            <div className="text-sm sm:text-base font-black text-slate-900 leading-snug">
              {formattedLastSync.primary}
            </div>
            {formattedLastSync.hasSyncedBefore && (
              <div className="text-[11px] text-slate-600 font-mono">
                التاريخ والوقت: {formattedLastSync.exact}
              </div>
            )}
          </div>

          {/* Enter Immediately CTA */}
          <button
            type="button"
            onClick={() => {
              soundFx.playClick();
              finishSplash();
            }}
            className="w-full min-h-[44px] bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600 hover:from-emerald-500 hover:via-teal-500 hover:to-sky-500 active:scale-[0.99] text-white font-black text-sm py-3 px-4 rounded-xl shadow-lg shadow-teal-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <span>{isDone ? 'الدخول للمتجر الآن' : 'تخطي والبدء فوراً'}</span>
            <ArrowLeft className="w-4 h-4" />
          </button>
        </div>
      </main>

      {/* Footer Note */}
      <footer className="max-w-lg w-full mx-auto text-center py-2 text-[11px] text-slate-500 font-medium">
        {shopName || 'مكتبة الطيب أحسن'} · العمل مستمر أونلاين وأوفلاين مع حفظ ومزامنة تلقائية
      </footer>
    </div>
  );
};
