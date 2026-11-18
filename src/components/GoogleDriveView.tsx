import React, { useState, useEffect, useCallback } from 'react';
import { 
  Cloud, 
  UploadCloud, 
  Download, 
  RefreshCw, 
  Trash2, 
  HardDrive, 
  ExternalLink, 
  FileText, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle, 
  LogOut, 
  Clock, 
  FolderSync, 
  Sparkles,
  ShoppingBag,
  FileSpreadsheet
} from 'lucide-react';
import { User } from 'firebase/auth';
import { AppDatabase } from '../types';
import { sanitizeDatabaseForExport } from '../data/storage';
import { GoogleSignInButton } from './GoogleSignInButton';
import { ConfirmModal } from './ConfirmModal';
import { 
  googleSignIn, 
  getAccessToken, 
  logoutGoogle, 
  initAuth 
} from '../services/googleAuth';
import { 
  getDriveStorageInfo, 
  listDriveBackups, 
  uploadBackupToDrive, 
  downloadBackupFromDrive, 
  deleteDriveFile, 
  uploadTextReportToDrive,
  DriveFileItem, 
  DriveStorageInfo 
} from '../services/googleDriveApi';

interface GoogleDriveViewProps {
  db: AppDatabase;
  onRestoreDatabase: (restoredDb: AppDatabase) => void;
  isOwner?: boolean;
  onRequestOwnerLogin?: () => void;
}

export const GoogleDriveView: React.FC<GoogleDriveViewProps> = ({
  db,
  onRestoreDatabase,
  isOwner = false,
  onRequestOwnerLogin,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [isSigningIn, setIsSigningIn] = useState<boolean>(false);

  // Drive state
  const [storageInfo, setStorageInfo] = useState<DriveStorageInfo | null>(null);
  const [backups, setBackups] = useState<DriveFileItem[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [backupNote, setBackupNote] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Confirmation Modals State (Mandatory for mutating Google Drive operations)
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    file: DriveFileItem | null;
    isDeleting: boolean;
  }>({
    isOpen: false,
    file: null,
    isDeleting: false,
  });

  const [restoreModal, setRestoreModal] = useState<{
    isOpen: boolean;
    file: DriveFileItem | null;
    isRestoring: boolean;
  }>({
    isOpen: false,
    file: null,
    isRestoring: false,
  });

  // Listen to auth state
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, accessToken) => {
        setUser(currentUser);
        setToken(accessToken);
        setIsAuthLoading(false);
      },
      () => {
        setUser(null);
        setToken(null);
        setIsAuthLoading(false);
      }
    );

    // Initial check for existing in-memory token
    getAccessToken().then((cached) => {
      if (cached) {
        setToken(cached);
      }
      setIsAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Fetch drive data when token is available
  const loadDriveData = useCallback(async (activeToken: string) => {
    setIsLoadingBackups(true);
    setStatusMessage(null);
    try {
      const [storage, files] = await Promise.all([
        getDriveStorageInfo(activeToken).catch(() => null),
        listDriveBackups(activeToken),
      ]);
      if (storage) setStorageInfo(storage);
      setBackups(files);
    } catch (err: unknown) {
      console.error('Error loading Google Drive data:', err);
      setStatusMessage({
        type: 'error',
        text: 'حدث خطأ أثناء تحميل ملفات Google Drive: ' + ((err as Error).message || 'تأكد من الاتصال بالإنترنت'),
      });
    } finally {
      setIsLoadingBackups(false);
    }
  }, []);

  useEffect(() => {
    if (token) {
      loadDriveData(token);
    }
  }, [token, loadDriveData]);

  // Handle Sign In
  const handleLogin = async () => {
    setIsSigningIn(true);
    setStatusMessage(null);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setToken(res.accessToken);
        setStatusMessage({
          type: 'success',
          text: `تم تسجيل الدخول بنجاح! مرحباً ${res.user.displayName || res.user.email}`,
        });
      }
    } catch (err: unknown) {
      console.error('Sign-in failed:', err);
      setStatusMessage({
        type: 'error',
        text: 'فشل تسجيل الدخول بواسطة Google. يرجى المحاولة مرة أخرى.',
      });
    } finally {
      setIsSigningIn(false);
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    await logoutGoogle();
    setUser(null);
    setToken(null);
    setStorageInfo(null);
    setBackups([]);
    setStatusMessage({
      type: 'info',
      text: 'تم تسجيل الخروج بنجاح من حساب Google',
    });
  };

  // Upload Backup
  const handleCreateBackup = async () => {
    if (!token) return;
    setIsUploading(true);
    setStatusMessage(null);
    try {
      const safeDb = sanitizeDatabaseForExport(db, isOwner);
      const uploadedFile = await uploadBackupToDrive(token, safeDb, backupNote.trim());
      setBackupNote('');
      setStatusMessage({
        type: 'success',
        text: `تم رفع النسخة الاحتياطية بنجاح إلى Google Drive (${uploadedFile.name})`,
      });
      // Refresh list
      await loadDriveData(token);
    } catch (err: unknown) {
      setStatusMessage({
        type: 'error',
        text: 'فشل رفع النسخة الاحتياطية إلى Google Drive: ' + ((err as Error).message || ''),
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Export Shortages Report to Drive
  const handleExportShortagesToDrive = async () => {
    if (!token) return;
    setIsUploading(true);
    setStatusMessage(null);
    try {
      const nowStr = new Date().toLocaleString('ar-EG');
      const shopTitle = db.settings.shop || 'المتجر';
      const textHeader = `قائمة نواقص ${shopTitle}\nتاريخ التصدير: ${nowStr}\nعدد البنود: ${db.shortages.length}\n${'='.repeat(40)}\n\n`;
      const textBody = db.shortages
        .map((s, idx) => `${idx + 1}. ${s.name} - الكمية المطلوبة: ${s.quantity} ${s.category ? `[${s.category}]` : ''}`)
        .join('\n');

      const fileName = `نواقص_${shopTitle.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.txt`;
      await uploadTextReportToDrive(token, fileName, textHeader + textBody, 'تقرير نواقص للموردين');
      setStatusMessage({
        type: 'success',
        text: `تم تصدير وحفظ كشف النواقص في Google Drive بنجاح!`,
      });
      await loadDriveData(token);
    } catch (err: unknown) {
      setStatusMessage({
        type: 'error',
        text: 'تعذر تصدير كشف النواقص: ' + ((err as Error).message || ''),
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Export Catalog Report to Drive
  const handleExportCatalogToDrive = async () => {
    if (!token) return;
    setIsUploading(true);
    setStatusMessage(null);
    try {
      const nowStr = new Date().toLocaleString('ar-EG');
      const shopTitle = db.settings.shop || 'المتجر';
      const textHeader = `كتالوج أصناف وقائمة أسعار - ${shopTitle}\nتاريخ التصدير: ${nowStr}\nإجمالي الأصناف: ${db.products.length}\n${'='.repeat(40)}\n\n`;
      const textBody = db.products
        .map((p, idx) => {
          const buyVal = p.buyWholesale ?? p.wholesalePrice;
          const wholesaleNote = isOwner && buyVal != null ? ` | سعر الجملة: ${buyVal} ج.م` : '';
          return `${idx + 1}. [${p.category || 'عام'}] ${p.name} - سعر القطاعي: ${p.price} ج.م${wholesaleNote}`;
        })
        .join('\n');

      const fileName = `كتالوج_أصناف_${shopTitle.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.txt`;
      await uploadTextReportToDrive(token, fileName, textHeader + textBody, 'كتالوج وقائمة أسعار الأصناف');
      setStatusMessage({
        type: 'success',
        text: `تم تصدير وحفظ كتالوج الأصناف في Google Drive بنجاح!`,
      });
      await loadDriveData(token);
    } catch (err: unknown) {
      setStatusMessage({
        type: 'error',
        text: 'تعذر تصدير الكتالوج: ' + ((err as Error).message || ''),
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Prompt Restore Modal (Protected: Store Owner Only)
  const requestRestore = (file: DriveFileItem) => {
    if (!isOwner) {
      setStatusMessage({
        type: 'error',
        text: '🔒 استرجاع النسخ الاحتياطية مقتصر على مالك المتجر فقط برمز الدخول السري.',
      });
      onRequestOwnerLogin?.();
      return;
    }
    setRestoreModal({
      isOpen: true,
      file,
      isRestoring: false,
    });
  };

  // Confirm Restore
  const handleConfirmRestore = async () => {
    if (!token || !restoreModal.file) return;
    if (!isOwner) {
      setStatusMessage({
        type: 'error',
        text: '🔒 استرجاع النسخ الاحتياطية مقتصر على مالك المتجر فقط.',
      });
      onRequestOwnerLogin?.();
      return;
    }
    setRestoreModal((prev) => ({ ...prev, isRestoring: true }));
    try {
      const restored = await downloadBackupFromDrive(token, restoreModal.file.id);
      onRestoreDatabase(restored);
      setRestoreModal({ isOpen: false, file: null, isRestoring: false });
      setStatusMessage({
        type: 'success',
        text: `تمت استعادة البيانات بنجاح من Google Drive ومزامنتها سحابياً! (${restored.products.length} صنف و ${restored.shortages?.length || 0} من النواقص)`,
      });
    } catch (err: unknown) {
      setRestoreModal((prev) => ({ ...prev, isRestoring: false }));
      setStatusMessage({
        type: 'error',
        text: 'فشلت استعادة النسخة من Google Drive: ' + ((err as Error).message || ''),
      });
    }
  };

  // Prompt Delete Modal (Protected: Store Owner Only)
  const requestDelete = (file: DriveFileItem) => {
    if (!isOwner) {
      setStatusMessage({
        type: 'error',
        text: '🔒 حذف ملفات النسخ الاحتياطي مقتصر على مالك المتجر فقط.',
      });
      onRequestOwnerLogin?.();
      return;
    }
    setDeleteModal({
      isOpen: true,
      file,
      isDeleting: false,
    });
  };

  // Confirm Delete
  const handleConfirmDelete = async () => {
    if (!token || !deleteModal.file) return;
    setDeleteModal((prev) => ({ ...prev, isDeleting: true }));
    try {
      await deleteDriveFile(token, deleteModal.file.id);
      setDeleteModal({ isOpen: false, file: null, isDeleting: false });
      setStatusMessage({
        type: 'success',
        text: 'تم حذف ملف النسخة الاحتياطية من Google Drive بنجاح.',
      });
      await loadDriveData(token);
    } catch (err: unknown) {
      setDeleteModal((prev) => ({ ...prev, isDeleting: false }));
      setStatusMessage({
        type: 'error',
        text: 'فشل حذف الملف من Google Drive: ' + ((err as Error).message || ''),
      });
    }
  };

  // Helpers
  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 بايت';
    const k = 1024;
    const sizes = ['بايت', 'كيلوبايت', 'ميجابايت', 'جيجابايت'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (isoStr: string): string => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Introduction */}
      <div className="bg-gradient-to-r from-emerald-800 to-teal-900 text-white p-6 rounded-3xl shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 w-64 h-64 bg-white/5 rounded-full -translate-x-1/2 -translate-y-1/2 pointer-events-none" />
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 text-xs font-semibold">
              <Cloud className="w-4 h-4 text-emerald-300" />
              <span>التخزين السحابي الآمن مع Google Drive</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold text-white">
              إدارة النسخ الاحتياطية والمزامنة مع Google Drive
            </h2>
            <p className="text-xs sm:text-sm text-slate-200 max-w-2xl leading-relaxed">
              احفظ كامل بيانات متجرك (الأصناف، الفواتير، النواقص، الأسعار) مباشرة في حسابك على Google Drive، لتضمن حماية بياناتك والوصول إليها أو استعادتها من أي هاتف أو جهاز كمبيوتر.
            </p>
          </div>

          {!user && (
            <div className="shrink-0 pt-2 md:pt-0">
              <GoogleSignInButton onClick={handleLogin} isLoading={isSigningIn} />
            </div>
          )}
        </div>
      </div>

      {/* Notification Banner */}
      {statusMessage && (
        <div
          className={`p-4 rounded-2xl text-xs sm:text-sm font-semibold flex items-center justify-between gap-3 shadow-xs ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : statusMessage.type === 'error'
              ? 'bg-rose-50 text-rose-800 border border-rose-200'
              : 'bg-blue-50 text-blue-800 border border-blue-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {statusMessage.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
            {statusMessage.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />}
            {statusMessage.type === 'info' && <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0" />}
            <span>{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-xs opacity-70 hover:opacity-100 underline shrink-0"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* If Not Signed In: Clean Card */}
      {!user && !isAuthLoading && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-6 shadow-xs">
          <div className="w-16 h-16 rounded-2xl bg-teal-50 border border-teal-100 text-teal-600 flex items-center justify-center mx-auto shadow-inner">
            <Cloud className="w-8 h-8" />
          </div>

          <div className="max-w-md mx-auto space-y-2">
            <h3 className="text-lg font-bold text-slate-900">سجّل الدخول بحساب Google للبدء</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              بالتسجيل بحساب Google الخاص بك، ستتمكن من إنشاء مجلد مخصص تلقائياً على Google Drive لحفظ واستعادة النسخ الاحتياطية وقوائم النواقص والأسعار بكبسة زر واحدة وبإذن كامل منك.
            </p>
          </div>

          <div className="flex justify-center pt-2">
            <GoogleSignInButton onClick={handleLogin} isLoading={isSigningIn} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-slate-100 max-w-2xl mx-auto text-right text-xs">
            <div className="p-3 bg-slate-50 rounded-xl space-y-1">
              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>أمان وخصوصية تامة</span>
              </span>
              <p className="text-[11px] text-slate-500">البيانات تُرسل مباشرة من متصفحك إلى حسابك الخاص على Google Drive.</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl space-y-1">
              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                <FolderSync className="w-4 h-4 text-teal-600" />
                <span>مجلد منظم ومستقل</span>
              </span>
              <p className="text-[11px] text-slate-500">يتم إنشاء مجلد باسم "نسخ احتياطية للمتجر - Store Backups" تلقائياً.</p>
            </div>
            <div className="p-3 bg-slate-50 rounded-xl space-y-1">
              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                <RefreshCw className="w-4 h-4 text-blue-600" />
                <span>استرجاع بنقرة واحدة</span>
              </span>
              <p className="text-[11px] text-slate-500">استرجع أصنافك وفواتيرك في أي وقت عند فتح التطبيق على أي جهاز جديد.</p>
            </div>
          </div>
        </div>
      )}

      {/* If Signed In: Full Drive Workspace */}
      {user && (
        <div className="space-y-6">
          {/* User Account & Drive Storage Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'Google User'}
                    className="w-12 h-12 rounded-2xl ring-2 ring-emerald-500/20 object-cover"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 font-extrabold flex items-center justify-center text-lg">
                    {user.displayName?.charAt(0) || user.email?.charAt(0) || 'G'}
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                      {user.displayName || 'مستخدم Google'}
                    </h3>
                    <span className="text-[11px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span>متصل بجوجل درايف</span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">{user.email}</p>
                </div>
              </div>

              {/* Logout button */}
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-3 py-2 rounded-xl transition-colors shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>تسجيل الخروج</span>
              </button>
            </div>

            {/* Storage Quota Progress */}
            {storageInfo && storageInfo.limitBytes > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100 text-xs space-y-2">
                <div className="flex justify-between items-center text-slate-600 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <HardDrive className="w-4 h-4 text-slate-400" />
                    <span>مساحة التخزين في Google Drive</span>
                  </span>
                  <span className="font-mono text-slate-900">
                    {formatBytes(storageInfo.usageBytes)} مستخدمة من أصل {formatBytes(storageInfo.limitBytes)}
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-teal-500 h-2 rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, Math.round((storageInfo.usageBytes / storageInfo.limitBytes) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Actions Grid: Upload New Backup & Export Reports */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Main Action: Upload DB Backup */}
            <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <UploadCloud className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                    رفع نسخة احتياطية جديدة الآن إلى Google Drive
                  </h3>
                </div>
                <span className="text-xs text-slate-400 font-semibold">
                  مجلد: نسخ احتياطية للمتجر (Store Backups)
                </span>
              </div>

              {/* Current App State Stats */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-lg font-black text-emerald-700">{db.products.length}</div>
                  <div className="text-[11px] font-bold text-slate-500">صنف في الكتالوج</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-lg font-black text-teal-700">{db.invoices.length}</div>
                  <div className="text-[11px] font-bold text-slate-500">فاتورة محفوظة</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-lg font-black text-amber-700">{db.shortages.length}</div>
                  <div className="text-[11px] font-bold text-slate-500">بند في النواقص</div>
                </div>
              </div>

              {/* Optional Note */}
              <div className="space-y-1.5 text-xs">
                <label className="block font-bold text-slate-700">ملاحظة للنسخة الاحتياطية (اختياري):</label>
                <input
                  type="text"
                  value={backupNote}
                  onChange={(e) => setBackupNote(e.target.value)}
                  placeholder="مثال: نسخة قبل جرد نهاية الأسبوع، أو بعد تعديل أسعار الكشاكيل"
                  className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-500 rounded-xl py-2 px-3 text-xs outline-none"
                />
              </div>

              {/* Upload Button */}
              <button
                onClick={handleCreateBackup}
                disabled={isUploading}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-4 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isUploading ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <UploadCloud className="w-5 h-5" />
                )}
                <span>{isUploading ? 'جارٍ تأمين ورفع النسخة إلى Google Drive...' : 'رفع وحفظ النسخة الاحتياطية في Google Drive'}</span>
              </button>
            </div>

            {/* Side Action: Export Reports to Drive */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
                  <FileText className="w-5 h-5 text-teal-600" />
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">تصدير تقارير إلى Drive</h3>
                </div>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  احفظ تقارير نصية وقوائم مرتبة مباشرة في Google Drive لمشاركتها أو فتحها من أي مكان:
                </p>
              </div>

              <div className="space-y-2.5">
                <button
                  onClick={handleExportShortagesToDrive}
                  disabled={isUploading || db.shortages.length === 0}
                  className="w-full text-right p-3 rounded-xl bg-amber-50 hover:bg-amber-100/80 border border-amber-200 text-amber-900 text-xs font-bold flex items-center justify-between transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-amber-700" />
                    <div>
                      <div>تصدير كشف النواقص</div>
                      <div className="text-[10px] text-amber-700/80 font-normal mt-0.5">{db.shortages.length} بند مطلوب للطلبيات</div>
                    </div>
                  </div>
                  <UploadCloud className="w-4 h-4 text-amber-700 shrink-0" />
                </button>

                <button
                  onClick={handleExportCatalogToDrive}
                  disabled={isUploading || db.products.length === 0}
                  className="w-full text-right p-3 rounded-xl bg-blue-50 hover:bg-blue-100/80 border border-blue-200 text-blue-900 text-xs font-bold flex items-center justify-between transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-blue-700" />
                    <div>
                      <div>تصدير كتالوج الأصناف والأسعار</div>
                      <div className="text-[10px] text-blue-700/80 font-normal mt-0.5">{db.products.length} صنف ومجموعة</div>
                    </div>
                  </div>
                  <UploadCloud className="w-4 h-4 text-blue-700 shrink-0" />
                </button>
              </div>
            </div>
          </div>

          {/* Saved Google Drive Backups Archive */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FolderSync className="w-5 h-5 text-teal-600" />
                <h3 className="font-bold text-slate-900 text-base">
                  النسخ الاحتياطية المحفوظة في Google Drive ({backups.length})
                </h3>
              </div>
              <button
                onClick={() => token && loadDriveData(token)}
                disabled={isLoadingBackups}
                className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                title="تحديث قائمة الملفات"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBackups ? 'animate-spin text-teal-600' : ''}`} />
                <span>تحديث</span>
              </button>
            </div>

            {isLoadingBackups ? (
              <div className="py-12 text-center text-slate-400 space-y-2">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto text-teal-600" />
                <p className="text-xs font-semibold">جارٍ استعراض ملفات النسخ من Google Drive...</p>
              </div>
            ) : backups.length === 0 ? (
              <div className="py-10 text-center text-slate-400 space-y-2">
                <Cloud className="w-10 h-10 mx-auto text-slate-300 stroke-[1.5]" />
                <p className="text-sm font-bold text-slate-700">لا توجد نسخ احتياطية محفوظة بعد في Google Drive</p>
                <p className="text-xs text-slate-500">
                  اضغط على زر "رفع وحفظ النسخة الاحتياطية في Google Drive" بالأعلى لإنشاء أول نسخة فوراً.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {backups.map((file) => {
                  const isJsonBackup = file.name.endsWith('.json');
                  const sizeInBytes = parseInt(file.size || '0', 10);

                  return (
                    <div
                      key={file.id}
                      className="py-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-slate-50/60 p-2 rounded-xl transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`p-1.5 rounded-lg ${isJsonBackup ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}`}>
                            {isJsonBackup ? <Cloud className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                          </span>
                          <span className="font-bold text-xs sm:text-sm text-slate-900 font-mono" dir="ltr">
                            {file.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-slate-500 mr-8">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            <span>{formatDate(file.createdTime)}</span>
                          </span>
                          {sizeInBytes > 0 && <span>• {formatBytes(sizeInBytes)}</span>}
                          {file.description && (
                            <span className="text-slate-600 font-medium truncate max-w-xs">
                              • {file.description}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* File Action Buttons */}
                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                        {/* Open in Google Drive Web */}
                        {file.webViewLink && (
                          <a
                            href={file.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 text-xs font-semibold flex items-center gap-1 transition-colors"
                            title="فتح الملف في موقع Google Drive"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span className="hidden md:inline">عرض في Drive</span>
                          </a>
                        )}

                        {/* Restore Button (Only for JSON backups) */}
                        {isJsonBackup && (
                          <button
                            onClick={() => requestRestore(file)}
                            className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-colors border border-emerald-200/60"
                            title="استعادة قاعدة البيانات من هذا الملف"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>استعادة</span>
                          </button>
                        )}

                        {/* Delete Button (MANDATORY User Confirmation Dialog) */}
                        <button
                          onClick={() => requestDelete(file)}
                          className="p-2 rounded-xl text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                          title="حذف الملف من Google Drive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal for Google Drive File Deletion (Mandatory for mutating Workspace APIs) */}
      <ConfirmModal
        isOpen={deleteModal.isOpen}
        title="حذف ملف من Google Drive"
        description={`هل أنت متأكد من رغبتك في حذف هذا الملف نهائياً من حساب Google Drive الخاص بك؟`}
        itemDetails={
          deleteModal.file
            ? [
                { label: 'اسم الملف', value: deleteModal.file.name },
                { label: 'تاريخ الإنشاء', value: formatDate(deleteModal.file.createdTime) },
              ]
            : undefined
        }
        confirmLabel="نعم، احذف الملف من Drive"
        cancelLabel="إلغاء التراجع"
        isDestructive={true}
        isLoading={deleteModal.isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteModal({ isOpen: false, file: null, isDeleting: false })}
      />

      {/* Confirmation Modal for Database Restore from Drive */}
      <ConfirmModal
        isOpen={restoreModal.isOpen}
        title="استعادة قاعدة البيانات من Google Drive"
        description="سيتم استبدال الأصناف والفواتير والنواقص الحالية في التطبيق بالبيانات المخزنة في هذه النسخة الاحتياطية. هل تود المتابعة؟"
        itemDetails={
          restoreModal.file
            ? [
                { label: 'ملف النسخة', value: restoreModal.file.name },
                { label: 'تاريخ النسخة', value: formatDate(restoreModal.file.createdTime) },
              ]
            : undefined
        }
        confirmLabel="استعادة واستبدال البيانات"
        cancelLabel="إلغاء"
        isDestructive={false}
        isLoading={restoreModal.isRestoring}
        onConfirm={handleConfirmRestore}
        onCancel={() => setRestoreModal({ isOpen: false, file: null, isRestoring: false })}
      />
    </div>
  );
};
