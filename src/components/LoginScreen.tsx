import React, { useState } from 'react';
import { 
  Store, 
  Lock, 
  User, 
  Phone, 
  Eye, 
  EyeOff, 
  ArrowRight, 
  UserPlus, 
  LogIn,
  ShieldCheck, 
  ShieldAlert,
  CheckCircle2
} from 'lucide-react';
import { AppDatabase } from '../types';
import { 
  apiLoginStore, 
  apiRegisterStore, 
  UserSession, 
  getRememberedCredentials, 
  saveRememberedCredentials, 
  clearRememberedCredentials 
} from '../data/userSession';

interface LoginScreenProps {
  onSuccess: (session: UserSession, db: AppDatabase) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onSuccess }) => {
  const initialCreds = getRememberedCredentials();
  const [activeTab, setActiveTab] = useState<'register' | 'login'>(initialCreds?.username ? 'login' : 'register');

  // Form Fields
  const [shopName, setShopName] = useState(initialCreds?.shop || '');
  const [shopPhone, setShopPhone] = useState(initialCreds?.phone || '');
  const [username, setUsername] = useState(initialCreds?.username || '');
  const [password, setPassword] = useState(initialCreds?.password || '');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(initialCreds ? initialCreds.rememberMe : true);
  const [hasRememberedCreds, setHasRememberedCreds] = useState(!!initialCreds?.username);

  // Status
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Clear remembered credentials handler
  const handleClearSaved = () => {
    clearRememberedCredentials();
    setHasRememberedCreds(false);
    setUsername('');
    setPassword('');
    setShopName('');
    setShopPhone('');
  };

  // Handle Registration (First-time user - Mandatory account creation)
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanShop = shopName.trim();
    const cleanUser = username.trim();
    const cleanPass = password.trim();

    if (!cleanShop) {
      setErrorMsg('يرجى إدخال اسم المتجر أو المكتبة الخاصة بك');
      return;
    }
    if (!cleanUser) {
      setErrorMsg('يرجى اختيار اسم مستخدم لحسابك');
      return;
    }
    if (!cleanPass || cleanPass.length < 4) {
      setErrorMsg('يرجى اختيار كلمة مرور قوية (لا تقل عن 4 أحرف أو أرقام)');
      return;
    }
    if (confirmPassword.trim() && cleanPass !== confirmPassword.trim()) {
      setErrorMsg('كلمة المرور وتأكيد كلمة المرور غير متطابقتين');
      return;
    }

    setIsLoading(true);
    try {
      const result = await apiRegisterStore({
        shop: cleanShop,
        phone: shopPhone.trim(),
        username: cleanUser,
        password: cleanPass,
      });

      // Save credentials if Remember Me is checked
      saveRememberedCredentials({
        username: cleanUser,
        password: cleanPass,
        shop: cleanShop,
        phone: shopPhone.trim(),
        rememberMe,
      });

      setIsLoading(false);
      onSuccess(result.user, result.db);
    } catch (err: unknown) {
      setIsLoading(false);
      setErrorMsg((err as Error).message || 'حدث خطأ أثناء إنشاء الحساب');
    }
  };

  // Handle Login (Existing registered user)
  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg(null);

    const cleanUser = username.trim();
    const cleanPass = password.trim();

    if (!cleanUser || !cleanPass) {
      setErrorMsg('يرجى كتابة اسم المستخدم وكلمة المرور الخاصة بك');
      return;
    }

    setIsLoading(true);
    try {
      const result = await apiLoginStore({
        username: cleanUser,
        password: cleanPass,
      });

      // Save or update credentials if Remember Me is checked
      saveRememberedCredentials({
        username: cleanUser,
        password: cleanPass,
        shop: result.user.shop,
        phone: result.user.phone,
        rememberMe,
      });

      setIsLoading(false);
      onSuccess(result.user, result.db);
    } catch (err: unknown) {
      setIsLoading(false);
      setErrorMsg((err as Error).message || 'اسم المستخدم أو كلمة المرور غير صحيحة');
    }
  };

  return (
    <div 
      className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 flex flex-col justify-center items-center p-4 relative overflow-hidden" 
      dir="rtl"
    >
      {/* Background glow effects */}
      <div className="absolute top-1/4 -right-20 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -left-20 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-md w-full relative z-10 space-y-5 my-6">
        {/* App Logo & Header */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-2xl shadow-emerald-950/50 mx-auto text-white">
            <Store className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            نظام إدارة المبيعات والمخزن
          </h1>
          <p className="text-xs text-slate-300">
            نظام سحابي آمن ومعزول لكل مستخدم — بياناتك خاصة بك تماماً
          </p>
        </div>

        {/* Mode Toggle Tabs (Register vs Login) */}
        <div className="bg-slate-800/80 p-1.5 rounded-2xl border border-slate-700/60 grid grid-cols-2 gap-1.5 text-xs font-bold text-center">
          <button
            type="button"
            onClick={() => {
              setActiveTab('register');
              setErrorMsg(null);
            }}
            className={`py-2.5 px-2 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'register'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            <span>تسجيل حساب جديد (إجباري)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('login');
              setErrorMsg(null);
            }}
            className={`py-2.5 px-2 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'login'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <LogIn className="w-4 h-4" />
            <span>تسجيل الدخول لحسابي</span>
          </button>
        </div>

        {/* Card Form */}
        <div className="bg-white rounded-3xl p-6 sm:p-7 shadow-2xl border border-slate-100 space-y-4">
          {/* Header Title */}
          <div className="pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              {activeTab === 'register' ? (
                <UserPlus className="w-5 h-5 text-emerald-600" />
              ) : (
                <LogIn className="w-5 h-5 text-teal-600" />
              )}
              <h2 className="font-bold text-base text-slate-900">
                {activeTab === 'register' 
                  ? 'تسجيل متجر جديد (صفحة جديدة بالكامل)' 
                  : 'تسجيل الدخول إلى حساب متجرك'}
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              {activeTab === 'register'
                ? 'يتم إنشاء متجرك فارغاً تماماً بدون أي أصناف أو فواتير سابقة، وتكون بياناتك خاصة بك ومحمية بكلمة مرورك فقط.'
                : 'أدخل اسم المستخدم وكلمة المرور الخاصة بحسابك المسجل لعرض بيانات متجرك من أي مكان.'}
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={activeTab === 'register' ? handleRegister : handleLogin} className="space-y-3.5 text-xs">
            {/* Store Name (Register Only) */}
            {activeTab === 'register' && (
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  اسم المكتبة / المتجر <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={shopName}
                    onChange={(e) => setShopName(e.target.value)}
                    placeholder="اكتب اسم متجرك أو مكتبتك هنا"
                    className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-500 focus:bg-white rounded-xl py-2.5 pr-9 pl-3 font-semibold text-slate-900 outline-none transition-all"
                  />
                  <Store className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
                </div>
              </div>
            )}

            {/* Phone Number (Register Only) */}
            {activeTab === 'register' && (
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  رقم الهاتف / واتساب للتواصل بالفواتير <span className="text-slate-400 font-normal">(اختياري)</span>
                </label>
                <div className="relative">
                  <input
                    type="tel"
                    value={shopPhone}
                    onChange={(e) => setShopPhone(e.target.value)}
                    placeholder="مثال: 01000000000"
                    className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-500 focus:bg-white rounded-xl py-2.5 pr-9 pl-3 font-mono font-semibold text-slate-900 outline-none transition-all"
                  />
                  <Phone className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
                </div>
              </div>
            )}

            {/* Username */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                اسم المستخدم الخاص بك <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={activeTab === 'register' ? 'اختر اسم مستخدم خاص بك' : 'اسم المستخدم المسجل'}
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-500 focus:bg-white rounded-xl py-2.5 pr-9 pl-3 font-semibold text-slate-900 outline-none transition-all"
                />
                <User className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                كلمة المرور <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-500 focus:bg-white rounded-xl py-2.5 pr-9 pl-9 font-mono font-semibold text-slate-900 outline-none transition-all"
                />
                <Lock className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-3 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Confirm Password (Register Only) */}
            {activeTab === 'register' && (
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  تأكيد كلمة المرور <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-500 focus:bg-white rounded-xl py-2.5 pr-9 pl-3 font-mono font-semibold text-slate-900 outline-none transition-all"
                  />
                  <CheckCircle2 className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
                </div>
              </div>
            )}

            {/* Remember Me Option */}
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 flex items-center justify-between gap-2">
              <label className="flex items-center gap-2.5 cursor-pointer select-none text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                />
                <span className="flex flex-col">
                  <span className="font-bold text-slate-800">حفظ بيانات الدخول على هذا الجهاز</span>
                  <span className="text-[10px] text-slate-400 font-normal">تذكرني دائماً حتى لا تضطر لكتابة اسم المستخدم وكلمة المرور كل مرة</span>
                </span>
              </label>

              {hasRememberedCreds && (
                <button
                  type="button"
                  onClick={handleClearSaved}
                  className="text-[11px] text-rose-600 hover:text-rose-700 font-semibold px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 transition-colors shrink-0"
                  title="مسح البيانات المحفوظة على هذا المتصفح"
                >
                  مسح المحفوظ
                </button>
              )}
            </div>

            {hasRememberedCreds && activeTab === 'login' && (
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>تم ملء بيانات الدخول المحفوظة مسبقاً لهذا الجهاز. يمكنك الدخول بضغطة زر واحدة!</span>
              </div>
            )}

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-4 rounded-xl shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
              >
                <span>
                  {isLoading
                    ? 'جارٍ التحقق...'
                    : activeTab === 'register'
                    ? 'إنشاء حساب المتجر والبدء بصفحة فارغة'
                    : 'تسجيل الدخول وعرض بياناتي'}
                </span>
                <ArrowRight className="w-4 h-4 rotate-180" />
              </button>
            </div>
          </form>
        </div>

        {/* Security & Privacy Assurance */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 text-center text-xs text-slate-300 space-y-1">
          <div className="flex items-center justify-center gap-1.5 font-bold text-emerald-400">
            <ShieldCheck className="w-4 h-4" />
            <span>خصوصية تامة وعزل كامل للبيانات</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            كل متجر له قاعدة بياناته المستقلة ومحمية ببيانات دخوله الخاصة. لن تظهر بياناتك أو أصنافك لأي مستخدم آخر.
          </p>
        </div>
      </div>
    </div>
  );
};
