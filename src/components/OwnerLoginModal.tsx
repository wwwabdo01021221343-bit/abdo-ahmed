import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Lock, 
  KeyRound, 
  X, 
  AlertCircle, 
  CheckCircle2, 
  Sparkles,
  LogOut
} from 'lucide-react';
import { signInAsOwner, signOutOwner } from '../services/firebase';
import { soundFx } from '../utils/audioFeedback';
import { updateOwnerPin, verifyOwnerPin } from '../utils/cryptoAuth';

interface OwnerLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  isOwner: boolean;
  onOwnerAuthenticated: () => void;
  onOwnerLoggedOut: () => void;
}

export const OwnerLoginModal: React.FC<OwnerLoginModalProps> = ({
  isOpen,
  onClose,
  isOwner,
  onOwnerAuthenticated,
  onOwnerLoggedOut,
}) => {
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [pinBusy, setPinBusy] = useState<boolean>(false);
  const [googleLoading, setGoogleLoading] = useState<boolean>(false);
  const [googleError, setGoogleError] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'pin' | 'google'>('pin');
  const [isChangingPin, setIsChangingPin] = useState<boolean>(false);
  const [currentPinForChange, setCurrentPinForChange] = useState<string>('');
  const [newPin, setNewPin] = useState<string>('');
  const [changePinStatus, setChangePinStatus] = useState<{ ok: boolean; text: string } | null>(null);

  if (!isOpen) return null;

  const handleSaveNewPin = async (e: React.FormEvent) => {
    e.preventDefault();
    soundFx.playClick();
    if (newPin.trim().length < 4) {
      soundFx.playWarning();
      setChangePinStatus({ ok: false, text: 'يجب أن يتكون الرمز السري من 4 أرقام أو أحرف على الأقل' });
      return;
    }
    const res = await updateOwnerPin(currentPinForChange, newPin.trim());
    if (res.success) {
      soundFx.playSuccess();
      setChangePinStatus({ ok: true, text: res.message });
      setNewPin('');
      setCurrentPinForChange('');
      setTimeout(() => {
        setIsChangingPin(false);
        setChangePinStatus(null);
      }, 1500);
    } else {
      soundFx.playWarning();
      setChangePinStatus({ ok: false, text: res.message });
    }
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    soundFx.playClick();
    if (!pinInput.trim()) {
      setPinError('يرجى إدخال الرمز السري لصاحب المتجر');
      return;
    }
    setPinBusy(true);
    const res = await verifyOwnerPin(pinInput);
    setPinBusy(false);

    if (res.success) {
      soundFx.playSuccess();
      localStorage.setItem('tayeb_owner_unlocked', 'true');
      setPinError('');
      setPinInput('');
      onOwnerAuthenticated();
      onClose();
    } else {
      soundFx.playWarning();
      setPinError(res.message || 'رمز المرور السري غير صحيح! يرجى التحقق وإعادة المحاولة.');
    }
  };

  const handleGoogleLogin = async () => {
    soundFx.playClick();
    setGoogleLoading(true);
    setGoogleError('');
    try {
      const res = await signInAsOwner();
      if (res.success && res.isOwner) {
        soundFx.playSuccess();
        localStorage.setItem('tayeb_owner_unlocked', 'true');
        onOwnerAuthenticated();
        onClose();
      } else if (res.success && !res.isOwner) {
        soundFx.playWarning();
        setGoogleError(
          `الحساب المسجل (${res.email}) غير مصرح له بصلاحيات صاحب المتجر. يرجى استخدام حساب المالك المعتمد.`
        );
      } else {
        soundFx.playWarning();
        setGoogleError(res.error || 'تعذر إتمام تسجيل الدخول');
      }
    } catch (err: any) {
      soundFx.playWarning();
      setGoogleError(err.message || 'حدث خطأ أثناء الاتصال');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSwitchToCashier = () => {
    soundFx.playClick();
    localStorage.removeItem('tayeb_owner_unlocked');
    onOwnerLoggedOut();
    onClose();
  };

  const handleFullGoogleSignOut = async () => {
    soundFx.playClick();
    localStorage.removeItem('tayeb_owner_unlocked');
    await signOutOwner();
    onOwnerLoggedOut();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-100 overflow-hidden text-right">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base">صلاحيات صاحب المتجر</h3>
              <p className="text-[11px] text-slate-400">إدارة الأصناف والأسعار والمجموعات</p>
            </div>
          </div>
          <button
            onClick={() => {
              soundFx.playClick();
              onClose();
            }}
            aria-label="إغلاق النافذة"
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 space-y-4">
          {isOwner ? (
            /* Already unlocked */
            <div className="text-center space-y-4 py-2">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-base">أنت مسجل حالياً كـ «صاحب المتجر» 👑</h4>
                <p className="text-xs text-slate-500 mt-1">
                  لديك كامل الصلاحيات لإضافة أصناف وتعديل الأسعار ورؤية أسعار الجملة والربط الفوري بالسحابة.
                </p>
              </div>

              {/* Change PIN option for owner */}
              <div className="pt-1">
                {!isChangingPin ? (
                  <button
                    type="button"
                    onClick={() => {
                      soundFx.playClick();
                      setIsChangingPin(true);
                      setChangePinStatus(null);
                    }}
                    className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                    <span>تغيير الرمز السري للمالك (PIN)</span>
                  </button>
                ) : (
                  <form onSubmit={handleSaveNewPin} className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-right">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        الرمز السري الحالي:
                      </label>
                      <input
                        type="password"
                        maxLength={12}
                        value={currentPinForChange}
                        onChange={(e) => setCurrentPinForChange(e.target.value)}
                        placeholder="أدخل الرمز الحالي..."
                        className="w-full text-center text-sm font-bold py-1.5 px-3 bg-white border border-slate-300 rounded-xl focus:border-amber-500 outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                        الرمز السري الجديد:
                      </label>
                      <input
                        type="password"
                        maxLength={12}
                        value={newPin}
                        onChange={(e) => setNewPin(e.target.value)}
                        placeholder="أدخل الرمز الجديد..."
                        className="w-full text-center text-sm font-bold py-1.5 px-3 bg-white border border-slate-300 rounded-xl focus:border-amber-500 outline-none"
                        required
                      />
                    </div>
                    {changePinStatus && (
                      <p className={`text-xs ${changePinStatus.ok ? 'text-emerald-600 font-bold' : 'text-rose-600'}`}>
                        {changePinStatus.text}
                      </p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <button
                        type="submit"
                        className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 rounded-xl text-xs cursor-pointer"
                      >
                        حفظ الرمز المشفر
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          soundFx.playClick();
                          setIsChangingPin(false);
                          setNewPin('');
                          setCurrentPinForChange('');
                          setChangePinStatus(null);
                        }}
                        className="px-3 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-2 rounded-xl text-xs cursor-pointer"
                      >
                        إلغاء
                      </button>
                    </div>
                  </form>
                )}
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleSwitchToCashier}
                  className="w-full bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold py-2.5 px-4 rounded-xl border border-amber-200 text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <Lock className="w-4 h-4" />
                  <span>التبديل لوضع الكاشير (قفل تعديل الأسعار وإخفاء الجملة)</span>
                </button>
                <button
                  type="button"
                  onClick={handleFullGoogleSignOut}
                  className="w-full bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold py-2 px-4 rounded-xl border border-rose-200 text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>تسجيل خروج كامل من حساب Google</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full bg-slate-900 text-white font-bold py-2.5 px-4 rounded-xl text-xs hover:bg-slate-800 cursor-pointer"
                >
                  إغلاق والمتابعة
                </button>
              </div>
            </div>
          ) : (
            /* Locked - Provide Login Methods */
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-950">
                  <Lock className="w-3.5 h-3.5" />
                  <span>خاص بالمالك فقط لمنع التعديل بالخطأ</span>
                </div>
                <p className="text-[11px] leading-relaxed text-amber-800">
                  وضع الكاشير يسمح بالبيع وعمل الفواتير وطلب النواقص دون تعديل الأسعار أو رؤية أسعار الجملة السرية.
                </p>
              </div>

              {/* Tabs: Quick PIN vs Google */}
              <div className="flex bg-slate-100 p-1 rounded-xl gap-1 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    soundFx.playClick();
                    setActiveTab('pin');
                  }}
                  className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'pin'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>الرمز السري السريع (PIN)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundFx.playClick();
                    setActiveTab('google');
                  }}
                  className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'google'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>حساب Google للمالك</span>
                </button>
              </div>

              {activeTab === 'pin' ? (
                /* PIN Form */
                <form onSubmit={handlePinSubmit} className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      أدخل الرمز السري لصاحب المتجر:
                    </label>
                    <input
                      type="password"
                      maxLength={12}
                      value={pinInput}
                      onChange={(e) => {
                        setPinInput(e.target.value);
                        setPinError('');
                      }}
                      placeholder="••••••"
                      autoFocus
                      className="w-full text-center tracking-widest text-lg font-bold py-2.5 px-4 bg-slate-50 border border-slate-300 rounded-xl focus:border-amber-500 outline-none transition-all placeholder:text-slate-400"
                    />
                    <p className="text-[11px] text-slate-500 mt-1.5 flex items-center justify-center gap-1">
                      <Lock className="w-3 h-3 text-slate-400" />
                      <span>الرمز السري محمي بتشفير كامل وحماية ضد التخمين.</span>
                    </p>
                  </div>

                  {pinError && (
                    <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{pinError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={pinBusy}
                    className="w-full bg-amber-500 hover:bg-amber-600 active:scale-98 text-white font-bold py-2.5 px-4 rounded-xl text-xs sm:text-sm shadow transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <KeyRound className="w-4 h-4" />
                    <span>{pinBusy ? 'جارٍ التحقق...' : 'تأكيد والدخول كصاحب متجر'}</span>
                  </button>
                </form>
              ) : (
                /* Google Sign-In */
                <div className="space-y-3">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    تسجيل الدخول بحساب Google المعتمد لصاحب المتجر لتفعيل صلاحيات المالك والمزامنة السحابية الآمنة.
                  </p>

                  {googleError && (
                    <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{googleError}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={googleLoading}
                    className="w-full bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 font-bold py-2.5 px-4 rounded-xl text-xs sm:text-sm shadow-2xs transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    <span>{googleLoading ? 'جارٍ تسجيل الدخول...' : 'دخول بحساب Google المعتمد'}</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
