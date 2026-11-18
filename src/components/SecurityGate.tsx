import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Lock, 
  User, 
  Eye, 
  EyeOff, 
  KeyRound, 
  BookOpen, 
  ArrowLeft, 
  MessageCircle, 
  AlertCircle
} from 'lucide-react';
import { soundFx } from '../utils/audioFeedback';
import {
  APP_GATE_STORAGE_KEY,
  normalizeCredentialDigits,
  verifyGateCredentials,
} from '../utils/cryptoAuth';
import { formatLastUpdatedLabel, readLastSyncInfo } from '../utils/syncLogic';
import { buildWhatsAppUrl } from '../utils/shopLogic';

export { APP_GATE_STORAGE_KEY };

interface SecurityGateProps {
  onUnlock: (remember: boolean) => void;
  shopName?: string;
  shopPhone?: string;
}

export const SecurityGate: React.FC<SecurityGateProps> = ({
  onUnlock,
  shopName = 'مكتبة الطيب أحسن',
  shopPhone = '01151906520',
}) => {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [rememberDevice, setRememberDevice] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanUser = normalizeCredentialDigits(username);
    const cleanPass = normalizeCredentialDigits(password);

    if (!cleanUser || !cleanPass) {
      soundFx.playWarning();
      setErrorMessage('يرجى إدخال اسم المستخدم وكلمة المرور');
      return;
    }

    setIsSubmitting(true);

    const result = await verifyGateCredentials(cleanUser, cleanPass, rememberDevice);
    if (result.success) {
      soundFx.playSuccess();
      setTimeout(() => {
        onUnlock(rememberDevice);
      }, 150);
    } else {
      soundFx.playWarning();
      setIsSubmitting(false);
      setErrorMessage(result.message || 'اسم المستخدم أو كلمة المرور غير صحيحة، يرجى المحاولة مرة أخرى.');
    }
  };

  return (
    <div 
      className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 flex flex-col justify-between p-4 sm:p-6 text-slate-100 font-sans selection:bg-teal-500 selection:text-white"
      dir="rtl"
    >
      {/* Top Bar Branding */}
      <header className="max-w-md w-full mx-auto pt-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-950/40">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white tracking-wide">{shopName}</h1>
            <p className="text-[11px] text-teal-300/80">نظام إدارة المبيعات والأصناف المحمي</p>
          </div>
        </div>

        <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-full">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>حماية مشفرة نشطة</span>
        </span>
      </header>

      {/* Main Login Card */}
      <main className="max-w-md w-full mx-auto my-auto py-6">
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 shadow-2xl rounded-3xl p-6 sm:p-8 space-y-6">
          
          {/* Header & Lock Icon */}
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-teal-500/20 via-emerald-500/10 to-transparent border border-teal-500/30 text-teal-400 flex items-center justify-center mx-auto shadow-inner">
              <Lock className="w-8 h-8 text-teal-400 stroke-[1.75]" />
            </div>
            
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              بوابة أمان الدخول للنظام
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
              هذا البرنامج محمي بتشفير كامل وحظر للمحاولات المتكررة لمنع أي دخول غير مصرح به.
            </p>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div role="alert" className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-3.5 flex items-start gap-3 text-rose-300 text-xs animate-shake">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed font-semibold">{errorMessage}</div>
            </div>
          )}

          {/* Auth Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            
            {/* Username Input */}
            <div className="space-y-1.5 text-right">
              <label 
                htmlFor="gate-username" 
                className="block text-xs font-bold text-slate-300"
              >
                اسم المستخدم:
              </label>
              <div className="relative">
                <input
                  id="gate-username"
                  type="text"
                  autoFocus
                  dir="ltr"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="أدخل اسم المستخدم"
                  className="w-full bg-slate-950/70 border border-slate-700/80 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 rounded-xl px-3.5 py-3 pr-10 text-sm text-white placeholder-slate-500 outline-none transition-all font-mono tracking-wider"
                  autoComplete="username"
                  required
                />
                <User className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-1.5 text-right">
              <label 
                htmlFor="gate-password" 
                className="block text-xs font-bold text-slate-300"
              >
                كلمة المرور:
              </label>
              <div className="relative">
                <input
                  id="gate-password"
                  type={showPassword ? 'text' : 'password'}
                  dir="ltr"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="••••••••"
                  className="w-full bg-slate-950/70 border border-slate-700/80 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 rounded-xl px-3.5 py-3 pr-10 pl-11 text-sm text-white placeholder-slate-500 outline-none transition-all font-mono tracking-wider"
                  autoComplete="current-password"
                  required
                />
                <KeyRound className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  title={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4 text-teal-400" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Remember Me Option */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                  className="w-4 h-4 rounded text-teal-600 bg-slate-950 border-slate-700 focus:ring-teal-500 focus:ring-offset-slate-900 cursor-pointer"
                />
                <span>تذكر تسجيل الدخول على هذا الجهاز</span>
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 active:scale-[0.99] text-white font-black py-3.5 px-4 rounded-xl shadow-lg shadow-teal-950/50 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60"
            >
              <ShieldCheck className="w-5 h-5 text-white" />
              <span className="text-sm">
                {isSubmitting ? 'جارٍ التحقق المشفر...' : 'تسجيل الدخول للنظام'}
              </span>
              <ArrowLeft className="w-4 h-4" />
            </button>
          </form>

          {/* Privacy Note */}
          <div className="border-t border-slate-800/80 pt-4 text-center">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              جميع بيانات المتجر، الفواتير، الأصناف، وأسعار الجملة مشفرة ومحفوظة بحماية السحابة.
            </p>
          </div>
        </div>

        {/* WhatsApp Assistance */}
        {shopPhone && (
          <div className="mt-4 text-center">
            <a
              href={buildWhatsAppUrl(shopPhone, 'السلام عليكم، أحتاج مساعدة في تسجيل الدخول لبرنامج مكتبة الطيب أحسن')}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-teal-300 transition-colors p-2"
            >
              <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span>هل نسيت بيانات الدخول؟ تواصل عبر واتساب المالك: {shopPhone}</span>
            </a>
          </div>
        )}
      </main>

      {/* Footer Info */}
      <footer className="text-center py-2 text-[11px] text-slate-400 space-y-1">
        {(() => {
          const lastSync = formatLastUpdatedLabel(readLastSyncInfo().lastSyncAt);
          return lastSync.hasSyncedBefore ? (
            <div className="text-teal-300/90 font-semibold">
              آخر تحديث محفوظ: {lastSync.primary}
            </div>
          ) : null;
        })()}
        <div className="text-slate-500">
          جميع الحقوق محفوظة © 2026 — {shopName} · حماية أمان السحابة
        </div>
      </footer>
    </div>
  );
};
