import React, { useState, useEffect, memo } from 'react';
import { 
  BookOpen, 
  LayoutDashboard,
  Clock, 
  MessageCircle, 
  Volume2, 
  VolumeX,
  ArrowRight,
  ShieldCheck,
  Lock,
  Cloud,
  WifiOff,
  RefreshCw,
  LogOut
} from 'lucide-react';
import { StoreSettings } from '../types';
import { soundFx } from '../utils/audioFeedback';
import { useSyncStatus, flushOfflineOutbox } from '../services/offlineSync';
import { buildWhatsAppUrl } from '../utils/shopLogic';

const LiveClock = memo(function LiveClock() {
  const [currentTime, setCurrentTime] = useState<string>(() =>
    new Date().toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(
        new Date().toLocaleTimeString('ar-EG', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-300 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700/60">
      <Clock className="w-3.5 h-3.5 text-teal-400" />
      <span className="font-mono text-xs">{currentTime}</span>
    </div>
  );
});

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  settings: StoreSettings;
  cartCount: number;
  shortagesCount: number;
  isOwner?: boolean;
  onOpenOwnerModal?: () => void;
  isCloudSynced?: boolean;
  onLockApp?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  settings,
  isOwner = false,
  onOpenOwnerModal,
  isCloudSynced = false,
  onLockApp,
}) => {
  const [soundEnabled, setSoundEnabled] = useState<boolean>(soundFx.isEnabled());
  const syncStatus = useSyncStatus();

  const handleToggleSound = () => {
    const newState = soundFx.toggle();
    setSoundEnabled(newState);
  };

  const handleGoHome = () => {
    soundFx.playClick();
    setActiveTab('home');
  };

  return (
    <header className="no-print bg-slate-900 text-white shadow-md sticky top-0 z-40">
      {/* Top Main Navigation Bar (Clean & Focused on 'الرئيسية') */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex flex-col md:flex-row items-center justify-between gap-2.5">
          {/* Logo & Store Info */}
          <div 
            onClick={handleGoHome}
            className="flex items-center gap-2.5 cursor-pointer group select-none shrink-0"
            title="الرجوع إلى الصفحة الرئيسية"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950/30 group-hover:scale-105 transition-transform shrink-0">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight text-white group-hover:text-emerald-400 transition-colors whitespace-nowrap">
                  {settings.shop || 'مكتبة الطيب أحسن'}
                </h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 whitespace-nowrap shrink-0">
                  نسخة المتجر
                </span>
              </div>
              <p className="text-[11px] text-slate-400 line-clamp-1">
                {settings.tagline || 'نظام إدارة المبيعات والأصناف والنواقص'}
              </p>
            </div>
          </div>

          {/* Controls: Primary "الرئيسية" Navigation, Sound Toggle, Clock, WhatsApp */}
          <div className="flex items-center gap-1.5 flex-wrap justify-center md:justify-end">
            {/* The ONLY main navigation button: الرئيسية */}
            {activeTab !== 'home' ? (
              <button
                onClick={handleGoHome}
                className="bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-md transition-all flex items-center gap-1.5 cursor-pointer border border-emerald-400/30 whitespace-nowrap"
                title="الرجوع إلى الصفحة الرئيسية"
              >
                <ArrowRight className="w-4 h-4" />
                <LayoutDashboard className="w-4 h-4" />
                <span>الرئيسية</span>
              </button>
            ) : (
              <div className="bg-slate-800/90 text-emerald-300 px-2.5 py-1.5 rounded-xl text-xs font-bold border border-slate-700/80 flex items-center gap-1.5 whitespace-nowrap">
                <LayoutDashboard className="w-3.5 h-3.5 text-emerald-400" />
                <span>الرئيسية</span>
              </div>
            )}

            {/* Live Cloud / Offline Sync Status Indicator */}
            {!syncStatus.isOnline ? (
              <div
                className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300 bg-amber-950/60 border border-amber-700/60 px-2.5 py-1.5 rounded-xl select-none whitespace-nowrap"
                title="أنت تعمل الآن بدون إنترنت: كل الإضافات والتعديلات محفوظة وستتزامن تلقائياً فور عودة النت"
              >
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                <span>أوفلاين{syncStatus.pendingCount > 0 ? ` (${syncStatus.pendingCount})` : ''}</span>
              </div>
            ) : syncStatus.isSyncing || syncStatus.pendingCount > 0 ? (
              <button
                type="button"
                onClick={() => flushOfflineOutbox(true, true)}
                className="flex items-center gap-1.5 text-[11px] font-bold text-sky-300 bg-sky-950/60 border border-sky-700/60 px-2.5 py-1.5 rounded-xl cursor-pointer whitespace-nowrap"
                title={syncStatus.isSyncing ? 'جاري رفع التغييرات للسحابة' : 'تعديلات محفوظة محلياً بانتظار المزامنة'}
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 text-sky-400 ${
                    syncStatus.isSyncing ? 'animate-spin motion-reduce:animate-none' : ''
                  }`}
                />
                <span>
                  {syncStatus.isSyncing
                    ? `جاري المزامنة (${syncStatus.pendingCount})`
                    : `بانتظار الرفع (${syncStatus.pendingCount})`}
                </span>
              </button>
            ) : !isCloudSynced ? (
              <div
                className="hidden sm:flex items-center gap-1 text-[11px] font-semibold text-amber-300 bg-amber-950/40 border border-amber-700/50 px-2.5 py-1.5 rounded-xl select-none whitespace-nowrap"
                title="قاعدة البيانات السحابية محمية: اربط الجهاز بحساب Google المعتمد لتفعيل المزامنة السحابية"
              >
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden lg:inline">بانتظار Google</span>
              </div>
            ) : (
              <div 
                className="hidden sm:flex items-center gap-1 text-[11px] font-semibold text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 px-2.5 py-1.5 rounded-xl select-none whitespace-nowrap"
                title="المزامنة السحابية الفورية مفعلة: التعديلات تظهر فوراً لجميع الأجهزة"
              >
                <Cloud className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden lg:inline">مزامنة تلقائية</span>
              </div>
            )}

            {/* Role Switcher: Store Owner vs Cashier / Staff */}
            {isOwner ? (
              <button
                onClick={() => {
                  soundFx.playClick();
                  onOpenOwnerModal?.();
                }}
                className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-400/50 px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all shadow-xs whitespace-nowrap"
                title="أنت مسجل كصاحب المتجر (اضغط لإدارة الصلاحيات أو تسجيل الخروج)"
              >
                <ShieldCheck className="w-4 h-4 text-amber-400" />
                <span className="text-[11px]">👑 المالك</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  soundFx.playClick();
                  onOpenOwnerModal?.();
                }}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all whitespace-nowrap"
                title="اضغط للدخول كصاحب متجر بالرمز السري وتفعيل إضافة وتعديل الأصناف"
              >
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden xl:inline text-[11px]">كاشير</span>
                <span className="text-[10px] text-amber-400 font-bold bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700">دخول المالك</span>
              </button>
            )}

            {/* App Lock / Logout Button */}
            {onLockApp && (
              <button
                onClick={() => {
                  soundFx.playClick();
                  onLockApp();
                }}
                className="bg-slate-800 hover:bg-rose-950/60 hover:text-rose-300 text-slate-300 border border-slate-700 hover:border-rose-800/60 px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap"
                title="قفل البرنامج وتأمين الدخول (يتطلب اسم المستخدم وكلمة المرور)"
              >
                <LogOut className="w-3.5 h-3.5 text-rose-400" />
                <span className="hidden sm:inline text-[11px]">قفل</span>
              </button>
            )}

            {/* Sound Toggle Button (Click / Audio Feedback) */}
            <button
              onClick={handleToggleSound}
              className={`p-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all border cursor-pointer whitespace-nowrap ${
                soundEnabled
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  : 'bg-rose-950/50 text-rose-300 border-rose-800/60 hover:bg-rose-900/40'
              }`}
              title={soundEnabled ? 'كتم أصوات النقر والإشعارات' : 'تفعيل صوت النقر'}
            >
              {soundEnabled ? (
                <>
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                  <span className="hidden xl:inline text-[11px]">صوت</span>
                </>
              ) : (
                <>
                  <VolumeX className="w-4 h-4 text-rose-400" />
                  <span className="hidden xl:inline text-[11px]">صامت</span>
                </>
              )}
            </button>

            {/* Live Clock (isolated so it never triggers header re-renders) */}
            <LiveClock />

            {/* WhatsApp Contact Button */}
            {settings.phone && (
              <a
                href={buildWhatsAppUrl(settings.phone)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => soundFx.playClick()}
                className="inline-flex items-center gap-1.5 bg-emerald-700/80 hover:bg-emerald-600 text-white px-2.5 py-1.5 rounded-xl text-xs font-semibold shadow transition-colors border border-emerald-600/40 whitespace-nowrap"
                title="تواصل مباشر عبر واتساب"
              >
                <MessageCircle className="w-3.5 h-3.5 fill-current" />
                <span>{settings.phone}</span>
              </a>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
