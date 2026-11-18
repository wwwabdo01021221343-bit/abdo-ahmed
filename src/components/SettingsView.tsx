import React, { useEffect, useState } from 'react';
import { 
  Download, 
  Upload, 
  Cloud, 
  RefreshCw, 
  AlertTriangle, 
  Check, 
  ShieldCheck, 
  Store, 
  CheckCircle2,
  Lock,
  UserPlus,
  Trash2,
  KeyRound,
  Mail,
  Rocket,
  ExternalLink
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { AppDatabase, CloudBackupManifest, StoreSettings, TrashItem } from '../types';
import { 
  exportDataAsJsonFile, 
  getCloudConfig, 
  parseImportedJson, 
  saveCloudConfig 
} from '../data/storage';
import {
  addAuthorizedEmail,
  AuthorizedEmailRecord,
  CloudAuthStatus,
  OWNER_EMAIL,
  removeAuthorizedEmail,
  signInWithGoogleForCloud,
  signOutOwner,
  subscribeToAuthorizedEmails
} from '../services/firebase';
import { getStoredGateToken, updateGateCredentials } from '../utils/cryptoAuth';
import { formatLastUpdatedLabel } from '../utils/syncLogic';
import { SyncStatusState } from '../services/offlineSync';
import { StartupSyncRefreshResult } from './StartupSyncSplash';
import { CloudVaultSection } from './CloudVaultSection';
import { ConfirmModal } from './ConfirmModal';
import type { GmailDailyBackupMeta } from '../services/gmailBackup';

interface SettingsViewProps {
  db: AppDatabase;
  onUpdateSettings: (settings: StoreSettings) => void;
  onRestoreDatabase: (newDb: AppDatabase) => void;
  onWipeDatabase: () => Promise<void> | void;
  onNavigate?: (tab: string) => void;
  isOwner?: boolean;
  onRequestOwnerLogin?: () => void;
  onLockApp?: () => void;
  firebaseUser?: User | null;
  cloudAuthStatus?: CloudAuthStatus;
  isCloudAdmin?: boolean;
  cloudBackups?: CloudBackupManifest[];
  cloudBackupsLoading?: boolean;
  onCreateManualCloudBackup: () => Promise<CloudBackupManifest>;
  onRestoreCloudBackup: (manifest: CloudBackupManifest) => Promise<AppDatabase>;
  onDownloadCloudBackupJson: (manifest: CloudBackupManifest) => Promise<void>;
  onDeleteCloudBackup: (backupId: string) => Promise<void>;
  onRestoreTrashItem: (item: TrashItem) => void;
  onPermanentDeleteTrashItem: (trashId: string) => void;
  onEmptyTrash: () => void;
  syncStatus?: SyncStatusState;
  onManualRefresh?: () => Promise<StartupSyncRefreshResult>;
  gmailBackupMeta?: GmailDailyBackupMeta;
  gmailBackupBusy?: boolean;
  gmailBackupFeedback?: { ok: boolean; text: string } | null;
  onSendDailyGmailBackup?: () => Promise<void> | void;
  todayDailyBackup?: CloudBackupManifest | null;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  db,
  onUpdateSettings,
  onRestoreDatabase,
  onWipeDatabase,
  onNavigate,
  isOwner = false,
  onRequestOwnerLogin,
  onLockApp,
  firebaseUser = null,
  cloudAuthStatus = 'unauthenticated',
  isCloudAdmin = false,
  cloudBackups = [],
  cloudBackupsLoading = false,
  onCreateManualCloudBackup,
  onRestoreCloudBackup,
  onDownloadCloudBackupJson,
  onDeleteCloudBackup,
  onRestoreTrashItem,
  onPermanentDeleteTrashItem,
  onEmptyTrash,
  syncStatus,
  onManualRefresh,
  gmailBackupMeta,
  gmailBackupBusy = false,
  gmailBackupFeedback,
  onSendDailyGmailBackup,
  todayDailyBackup = null,
}) => {
  // Store info form
  const [shopName, setShopName] = useState(db.settings.shop || 'مكتبة الطيب أحسن');
  const [shopPhone, setShopPhone] = useState(db.settings.phone || '01151906520');
  const [shopTagline, setShopTagline] = useState(db.settings.tagline || '');
  const [storeSavedToast, setStoreSavedToast] = useState(false);

  // Cloud config form
  const [cloudUrl, setCloudUrl] = useState(getCloudConfig().url);
  const [cloudKey, setCloudKey] = useState(getCloudConfig().key);
  const [cloudStatus, setCloudStatus] = useState<string>('جاهز للاتصال');
  const [isCloudBusy, setIsCloudBusy] = useState<boolean>(false);
  const [isManualSyncing, setIsManualSyncing] = useState<boolean>(false);
  const [manualSyncMsg, setManualSyncMsg] = useState<string | null>(null);

  // Authorized Google emails allowlist (Owner only when Firebase signed in as Owner)
  const isFirebaseOwner = Boolean(
    firebaseUser?.emailVerified &&
      firebaseUser?.email?.toLowerCase() === OWNER_EMAIL.toLowerCase()
  );
  const [authorizedEmails, setAuthorizedEmails] = useState<AuthorizedEmailRecord[]>([]);
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffLabel, setNewStaffLabel] = useState('');
  const [staffStatus, setStaffStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [staffBusy, setStaffBusy] = useState(false);

  // Confirmation modal states (avoids native window.alert/confirm in iframes & PWAs)
  const [pendingRemoveEmail, setPendingRemoveEmail] = useState<string | null>(null);
  const [isWipeModalOpen, setIsWipeModalOpen] = useState(false);
  const [isWipeBusy, setIsWipeBusy] = useState(false);
  const [wipeFeedback, setWipeFeedback] = useState<string | null>(null);

  // Gate credentials change form (Owner only)
  const [showGateChange, setShowGateChange] = useState(false);
  const [gateOldPass, setGateOldPass] = useState('');
  const [gateNewUser, setGateNewUser] = useState('');
  const [gateNewPass, setGateNewPass] = useState('');
  const [gateChangeStatus, setGateChangeStatus] = useState<{ ok: boolean; text: string } | null>(null);

  // One-click free static hosting bundle download
  const [deployZipBusy, setDeployZipBusy] = useState(false);
  const [deployZipMsg, setDeployZipMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleDownloadDeployBundle = async () => {
    if (!isOwner) {
      onRequestOwnerLogin?.();
      return;
    }
    setDeployZipBusy(true);
    setDeployZipMsg(null);
    try {
      const token = getStoredGateToken();
      const resp = await fetch('/api/deploy-bundle.zip', {
        headers: {
          'x-tayeb-bundle-request': '1',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const contentType = resp.headers.get('content-type') || '';
      if (!resp.ok || !contentType.includes('application/zip')) {
        if (contentType.includes('text/html')) {
          setDeployZipMsg({
            ok: false,
            text: 'أنت تفتح التطبيق الآن من استضافة ثابتة خارجية. لتنزيل أحدث ملف نشر (.zip)، افتح رابط AI Studio واضغط تنزيل الحزمة.',
          });
        } else {
          const errJson = await resp.json().catch(() => null);
          setDeployZipMsg({
            ok: false,
            text: errJson?.message || 'تعذر تجهيز ملف النشر حالياً.',
          });
        }
        return;
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tayeb-store-free-hosting.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setDeployZipMsg({
        ok: true,
        text: '✓ تم تنزيل الملف (tayeb-store-free-hosting.zip) على جهازك! الآن افتح صفحة الرفع المجاني بالزر المجاور واختر هذا الملف من التنزيلات.',
      });
    } catch {
      setDeployZipMsg({
        ok: false,
        text: 'تعذر تنزيل حزمة النشر. تأكد من الاتصال بالإنترنت وحاول مرة أخرى.',
      });
    } finally {
      setDeployZipBusy(false);
    }
  };

  useEffect(() => {
    if (!isFirebaseOwner) {
      setAuthorizedEmails([]);
      return;
    }
    const unsub = subscribeToAuthorizedEmails(
      (list) => setAuthorizedEmails(list),
      () => {}
    );
    return () => unsub();
  }, [isFirebaseOwner]);

  const handleAddAuthorizedEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffStatus(null);
    setStaffBusy(true);
    try {
      await addAuthorizedEmail(newStaffEmail, newStaffLabel);
      setNewStaffEmail('');
      setNewStaffLabel('');
      setStaffStatus({ ok: true, text: 'تمت إضافة البريد لقائمة الأجهزة المصرح لها بالسحابة بنجاح!' });
    } catch (err: unknown) {
      setStaffStatus({ ok: false, text: (err as Error)?.message || 'تعذر إضافة البريد' });
    } finally {
      setStaffBusy(false);
    }
  };

  const confirmRemoveAuthorizedEmail = async () => {
    if (!pendingRemoveEmail) return;
    const targetEmail = pendingRemoveEmail;
    try {
      await removeAuthorizedEmail(targetEmail);
      setStaffStatus({ ok: true, text: `تم سحب صلاحية الوصول السحابي عن ${targetEmail}` });
    } catch (err: unknown) {
      setStaffStatus({ ok: false, text: (err as Error)?.message || 'تعذر الحذف' });
    } finally {
      setPendingRemoveEmail(null);
    }
  };

  const handleGateCredentialUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGateChangeStatus(null);
    const res = await updateGateCredentials(gateOldPass, gateNewUser, gateNewPass);
    setGateChangeStatus({ ok: res.success, text: res.message });
    if (res.success) {
      setGateOldPass('');
      setGateNewUser('');
      setGateNewPass('');
    }
  };

  // Handle store info save (Protected: Store Owner Only)
  const handleSaveStoreSettings = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) {
      onRequestOwnerLogin?.();
      return;
    }
    onUpdateSettings({
      shop: shopName.trim() || 'مكتبة الطيب أحسن',
      phone: shopPhone.trim(),
      tagline: shopTagline.trim()
    });
    setStoreSavedToast(true);
    setTimeout(() => setStoreSavedToast(false), 2500);
  };

  const [restoreFeedback, setRestoreFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Handle local file restore (Protected: Store Owner Only)
  const handleFileRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isOwner) {
      setRestoreFeedback({
        ok: false,
        text: '🔒 استرجاع النسخ الاحتياطية مقتصر على مالك المتجر فقط برمز الدخول السري.',
      });
      onRequestOwnerLogin?.();
      e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = parseImportedJson(content);
        const cloudLinked = cloudAuthStatus === 'authorized';
        const msg = cloudLinked
          ? `تمت استعادة ${parsed.products.length} صنف و${parsed.shortages?.length || 0} نواقص و${parsed.invoices.length} فاتورة بنجاح، وبدأ الرفع للسحابة لجميع الأجهزة.`
          : `تمت استعادة ${parsed.products.length} صنف و${parsed.shortages?.length || 0} نواقص و${parsed.invoices.length} فاتورة وحفظها بأمان على هذا الجهاز! اضغط "ربط السحابة بحساب Google" أعلى الصفحة لرفعها فوراً لباقي أجهزتك.`;
        onRestoreDatabase(parsed);
        setRestoreFeedback({ ok: true, text: msg });
      } catch (err: unknown) {
        setRestoreFeedback({
          ok: false,
          text: 'تعذر استعادة الملف: ' + ((err as Error).message || 'ملف غير صالح'),
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Save Cloud Config
  const handleSaveCloudConfig = () => {
    if (!isOwner) return;
    saveCloudConfig({ url: cloudUrl.trim(), key: cloudKey.trim() });
  };

  // Cloud Upload to Google Drive via Apps Script (Protected: Store Owner Only)
  const handleCloudUpload = () => {
    if (!isOwner) {
      onRequestOwnerLogin?.();
      return;
    }
    if (!cloudUrl.trim().startsWith('https://script.google.com/macros/s/')) {
      setCloudStatus('تأكد من إدخال رابط Google Apps Script صحيح ينتهي بـ /exec');
      return;
    }
    if (!cloudKey.trim()) {
      setCloudStatus('يرجى إدخال مفتاح الحماية الخاص بتطبيق جوجل درايف');
      return;
    }

    handleSaveCloudConfig();
    setIsCloudBusy(true);
    setCloudStatus('جارٍ إرسال وتأمين النسخة إلى Google Drive...');

    try {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = cloudUrl.trim();
      form.target = 'cloud-hidden-frame';
      form.style.display = 'none';

      const dataField = document.createElement('input');
      dataField.type = 'hidden';
      dataField.name = 'data';
      dataField.value = JSON.stringify(db);
      form.appendChild(dataField);

      const keyField = document.createElement('input');
      keyField.type = 'hidden';
      keyField.name = 'securityKey';
      keyField.value = cloudKey.trim();
      form.appendChild(keyField);

      const actionField = document.createElement('input');
      actionField.type = 'hidden';
      actionField.name = 'action';
      actionField.value = 'backup';
      form.appendChild(actionField);

      document.body.appendChild(form);
      form.submit();

      setTimeout(() => {
        document.body.removeChild(form);
        setIsCloudBusy(false);
        setCloudStatus('تم إرسال النسخة بنجاح إلى درايف!');
      }, 2500);
    } catch {
      setIsCloudBusy(false);
      setCloudStatus('فشل الإرسال، تحقق من الرابط والمفتاح.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Hidden iframe for Apps Script submission */}
      <iframe name="cloud-hidden-frame" id="cloud-hidden-frame" className="hidden" title="Google Drive Sync" />

      {/* Direct Startup & System Info Card */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-5 rounded-2xl border border-slate-700 shadow-md flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-black text-xl flex items-center justify-center shadow-lg shadow-emerald-950/40 shrink-0">
              <Store className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm sm:text-base font-black text-emerald-400">
                  {db.settings.shop || 'مكتبة الطيب أحسن'}
                </span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>فتح وتحديث تلقائي</span>
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                البرنامج يتحقق من التحديثات تلقائياً عند كل فتح، ويحفظ الأصناف والفواتير والنواقص أونلاين وأوفلاين.
              </p>
              <div className="text-[11px] text-teal-300 mt-1.5 font-semibold">
                آخر تحديث سحابي: {formatLastUpdatedLabel(syncStatus?.lastSyncAt).primary}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end flex-wrap">
            <div className="text-xs text-slate-300 bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700 text-center">
              <span className="text-slate-400 block text-[10px]">إجمالي الأصناف</span>
              <strong className="text-white font-bold">{db.products.length} صنف</strong>
            </div>
            <div className="text-xs text-slate-300 bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700 text-center">
              <span className="text-slate-400 block text-[10px]">فواتير المبيعات</span>
              <strong className="text-emerald-400 font-bold">{db.invoices.length} فاتورة</strong>
            </div>
            {onManualRefresh && (
              <button
                type="button"
                disabled={isManualSyncing || Boolean(syncStatus?.isSyncing)}
                onClick={async () => {
                  if (isManualSyncing) return;
                  setIsManualSyncing(true);
                  setManualSyncMsg(null);
                  try {
                    const res = await onManualRefresh();
                    if (res.outcome === 'synced') {
                      setManualSyncMsg(`تم التحديث الآن (${res.productCount} صنف · ${res.invoiceCount} فاتورة)`);
                    } else if (res.outcome === 'offline') {
                      setManualSyncMsg('أنت أوفلاين حالياً — محفوظ محلياً');
                    } else {
                      setManualSyncMsg(res.message || 'تعذر الاتصال بالسحابة حالياً');
                    }
                  } finally {
                    setIsManualSyncing(false);
                  }
                }}
                className="min-h-[44px] bg-teal-500 hover:bg-teal-400 text-slate-950 font-black text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${isManualSyncing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
                <span>{isManualSyncing ? 'جاري التحديث...' : 'تحديث الآن'}</span>
              </button>
            )}
          </div>
        </div>
        {manualSyncMsg && (
          <div role="status" className="text-xs font-bold text-emerald-300 bg-slate-950/60 border border-slate-700 rounded-xl px-3 py-2">
            {manualSyncMsg}
          </div>
        )}
      </div>

      {/* Daily Cloud Backups Vault & 30-Day Soft-Delete Trash Bin */}
      <CloudVaultSection
        trashItems={db.trash || []}
        isOwner={isOwner}
        isCloudAdmin={isCloudAdmin}
        cloudAuthStatus={cloudAuthStatus}
        cloudBackups={cloudBackups}
        cloudBackupsLoading={cloudBackupsLoading}
        onRequestOwnerLogin={onRequestOwnerLogin}
        onCreateManualCloudBackup={onCreateManualCloudBackup}
        onRestoreCloudBackup={onRestoreCloudBackup}
        onDownloadCloudBackupJson={onDownloadCloudBackupJson}
        onDeleteCloudBackup={onDeleteCloudBackup}
        onRestoreTrashItem={onRestoreTrashItem}
        onPermanentDeleteTrashItem={onPermanentDeleteTrashItem}
        onEmptyTrash={onEmptyTrash}
        onNavigate={onNavigate}
        gmailBackupMeta={gmailBackupMeta}
        gmailBackupBusy={gmailBackupBusy}
        gmailBackupFeedback={gmailBackupFeedback}
        onSendDailyGmailBackup={onSendDailyGmailBackup}
        totalProductsCount={db.products.length}
        totalInvoicesCount={db.invoices.length}
        totalShortagesCount={db.shortages.length}
        todayDailyBackup={todayDailyBackup}
      />

      {/* Store Info Card */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Store className="w-5 h-5 text-emerald-600" />
            <h2 className="font-bold text-base text-slate-900">بيانات المكتبة والفواتير</h2>
          </div>
          {storeSavedToast && (
            <span className="text-xs font-bold text-emerald-600 flex items-center gap-1 bg-emerald-50 px-2.5 py-1 rounded-md animate-in fade-in">
              <Check className="w-3.5 h-3.5" />
              <span>تم حفظ البيانات بنجاح!</span>
            </span>
          )}
        </div>

        <form onSubmit={handleSaveStoreSettings} className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">اسم المكتبة / المتجر</label>
            <input
              type="text"
              required
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="مثال: مكتبة الطيب أحسن"
              className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-500 rounded-xl py-2.5 px-3 font-bold text-slate-900 outline-none"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">رقم واتساب للتواصل المباشر بالفواتير</label>
            <input
              type="text"
              required
              value={shopPhone}
              onChange={(e) => setShopPhone(e.target.value)}
              placeholder="مثال: 01151906520"
              className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-500 rounded-xl py-2.5 px-3 font-bold font-mono text-slate-900 outline-none"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block font-bold text-slate-700 mb-1">وصف المتجر / عبارة أسفل الفاتورة</label>
            <input
              type="text"
              value={shopTagline}
              onChange={(e) => setShopTagline(e.target.value)}
              placeholder="مثال: لجميع الأدوات المدرسية والورقيات والخدمات الطلابية"
              className="w-full bg-slate-50 border border-slate-300 focus:border-emerald-500 rounded-xl py-2 px-3 font-semibold text-slate-900 outline-none"
            />
          </div>

          <div className="sm:col-span-2 flex justify-end">
            <button
              type="submit"
              className={`font-bold px-6 py-2.5 rounded-xl shadow-sm transition-all flex items-center gap-1.5 cursor-pointer ${
                isOwner
                  ? 'bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white'
                  : 'bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300'
              }`}
            >
              {isOwner ? <Check className="w-4 h-4" /> : <Lock className="w-4 h-4 text-amber-600" />}
              <span>{isOwner ? 'حفظ التعديلات' : 'دخول المالك لحفظ التعديلات'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Local Backup & Restore */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <Download className="w-5 h-5 text-blue-600" />
          <h2 className="font-bold text-base text-slate-900">النسخ الاحتياطي المحلي</h2>
        </div>

        <p className="text-xs text-slate-500 leading-relaxed">
          جميع بياناتك (الأصناف، الفواتير، النواقص، الأسعار) محفوظة بأمان على جهازك. يمكنك تحميل نسخة احتياطية في أي وقت كملف JSON لضمان عدم ضياعها أو نقلها لجهاز آخر.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {/* Export JSON (strips confidential wholesale prices if not owner) */}
          <button
            onClick={() => exportDataAsJsonFile(db, isOwner)}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold p-3.5 rounded-xl text-right flex items-center justify-between shadow-sm transition-transform active:scale-[0.99] cursor-pointer"
          >
            <div>
              <div className="text-sm">تنزيل نسخة احتياطية (ملف JSON)</div>
              <div className="text-[11px] text-slate-300 mt-0.5">
                {isOwner
                  ? 'تحميل كامل للأصناف والفواتير والنواقص الخاصة بك'
                  : 'تحميل الأصناف والفواتير والنواقص (بدون أسعار الجملة السرية)'}
              </div>
            </div>
            <Download className="w-5 h-5 text-blue-400 shrink-0 mr-2" />
          </button>

          {/* Import JSON */}
          {isOwner ? (
            <label className="bg-slate-100 hover:bg-slate-200/80 text-slate-800 font-bold p-3.5 rounded-xl text-right flex items-center justify-between cursor-pointer border border-slate-300 transition-colors">
              <div>
                <div className="text-sm">استعادة نسخة من ملف</div>
                <div className="text-[11px] text-slate-500 mt-0.5">رفع واسترجاع نسخة سابقة وتحديث السحابة تلقائياً</div>
              </div>
              <Upload className="w-5 h-5 text-slate-600 shrink-0 mr-2" />
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleFileRestore}
                className="hidden"
              />
            </label>
          ) : (
            <button
              type="button"
              onClick={onRequestOwnerLogin}
              className="bg-amber-50 hover:bg-amber-100/90 text-amber-950 font-bold p-3.5 rounded-xl text-right flex items-center justify-between border border-amber-300/80 transition-colors cursor-pointer"
              title="استعادة النسخ الاحتياطية مقتصرة على المالك"
            >
              <div>
                <div className="text-sm flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>استعادة نسخة من ملف (المالك فقط)</span>
                </div>
                <div className="text-[11px] text-amber-700/90 mt-0.5">انقر للدخول برمز المالك لاسترجاع النسخة ومزامنة السحابة</div>
              </div>
              <Upload className="w-5 h-5 text-amber-600 shrink-0 mr-2" />
            </button>
          )}
        </div>

        {restoreFeedback && (
          <div
            role="status"
            className={`p-3 rounded-xl border text-xs font-bold leading-relaxed ${
              restoreFeedback.ok
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            {restoreFeedback.text}
          </div>
        )}
      </div>

      {/* Google Drive Native Workspace Integration */}
      <div className="bg-gradient-to-br from-teal-900 via-slate-900 to-emerald-950 text-white p-5 rounded-2xl border border-teal-800/50 shadow-md space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-teal-800/40">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center border border-teal-500/30">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-white">المزامنة مع Google Drive</h2>
              <p className="text-xs text-teal-200/80">حفظ واسترجاع سحابي مباشر بحساب Google الخاص بك</p>
            </div>
          </div>
          <span className="text-[11px] bg-emerald-500/20 text-emerald-300 font-bold px-3 py-1 rounded-full border border-emerald-500/30 self-start sm:self-auto">
            Google Workspace OAuth
          </span>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          يمكنك ربط حسابك في Google Drive لحفظ نسخ احتياطية واسترجاعها بضغطة زر وتصدير تقارير المبيعات والأصناف.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-3 pt-1">
          {onNavigate && (
            <button
              onClick={() => onNavigate('drive')}
              className="w-full sm:w-auto bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold px-5 py-2.5 rounded-xl shadow transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Cloud className="w-4 h-4" />
              <span>فتح مركز إدارة Google Drive</span>
            </button>
          )}

          <div className="text-xs text-teal-200/90 font-medium">
            تصفح النسخ السابقة، التصدير، واستعادة الفواتير من درايف مباشرة.
          </div>
        </div>
      </div>

      {/* Zero-Terminal Free Hosting Bundle Export (Mobile & Desktop Friendly) */}
      <div className="bg-gradient-to-br from-indigo-950 via-slate-900 to-sky-950 text-white p-5 rounded-2xl border border-indigo-800/50 shadow-md space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-indigo-800/40">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-500/20 text-sky-300 flex items-center justify-center border border-sky-400/30 shrink-0">
              <Rocket className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-white">النشر المجاني من الهاتف (بدون كمبيوتر ولا فيزا)</h2>
              <p className="text-xs text-sky-200/80">بديل مجاني دائم إذا طلب زر Publish في AI Studio ربط بطاقة دفع</p>
            </div>
          </div>
          <span className="text-[11px] bg-emerald-500/20 text-emerald-300 font-bold px-3 py-1 rounded-full border border-emerald-500/30 self-start sm:self-auto">
            مجاني 100%
          </span>
        </div>

        <ol className="text-xs text-slate-200 space-y-1.5 list-decimal list-inside leading-relaxed">
          <li>اضغط <strong>تنزيل حزمة النشر الجاهزة (.zip)</strong> بالأسفل لحفظ ملف واحد على هاتفك.</li>
          <li>افتح <strong>صفحة الرفع المجاني (Netlify Drop)</strong> واضغط لاختيار الملف من التنزيلات — وخلال ثوانٍ ستحصل على رابط مجاني دائم يفتح على كل الأجهزة.</li>
          <li className="text-slate-300">المزامنة بين الأجهزة والنسخ اليومي التلقائي يعملان فوراً؛ وإذا أردت فتح جيميل المالك على الرابط الجديد أضفه في Firebase Auth &larr; Authorized Domains.</li>
        </ol>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleDownloadDeployBundle}
            disabled={deployZipBusy}
            className={`font-bold px-4 py-2.5 rounded-xl shadow transition-all flex items-center justify-center gap-2 text-xs cursor-pointer ${
              isOwner
                ? 'bg-sky-500 hover:bg-sky-400 text-slate-950'
                : 'bg-amber-100 hover:bg-amber-200 text-amber-950'
            }`}
          >
            {isOwner ? <Download className="w-4 h-4" /> : <Lock className="w-4 h-4 text-amber-700" />}
            <span>
              {!isOwner
                ? 'دخول المالك لتنزيل حزمة النشر (.zip)'
                : deployZipBusy
                ? 'جارٍ تجهيز الملف المضغوط...'
                : '1. تنزيل حزمة النشر الجاهزة (.zip)'}
            </span>
          </button>

          <a
            href="https://app.netlify.com/drop"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white/10 hover:bg-white/20 text-white font-bold px-4 py-2.5 rounded-xl border border-white/20 transition-all flex items-center justify-center gap-2 text-xs"
          >
            <ExternalLink className="w-4 h-4 text-sky-300" />
            <span>2. فتح صفحة الرفع المجاني (Netlify Drop)</span>
          </a>
        </div>

        {deployZipMsg && (
          <div
            role="status"
            className={`p-3 rounded-xl text-xs font-bold leading-relaxed border ${
              deployZipMsg.ok
                ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-950/70 border-rose-500/40 text-rose-200'
            }`}
          >
            {deployZipMsg.text}
          </div>
        )}
      </div>

      {/* Advanced Legacy Apps Script Fallback (Optional) */}
      <details className="bg-white p-4 rounded-2xl border border-slate-200 text-xs space-y-3 group">
        <summary className="font-bold text-slate-700 cursor-pointer flex items-center justify-between select-none">
          <span className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-slate-400" />
            <span>خيارات مزامنة بديلة متقدمة (Google Apps Script Web App)</span>
          </span>
          <span className="text-slate-400 group-open:rotate-180 transition-transform">▼</span>
        </summary>

        <div className="pt-3 border-t border-slate-100 space-y-3">
          <div>
            <label className="block font-bold text-slate-700 mb-1">
              رابط تطبيق Google Apps Script المنشور
            </label>
            <input
              type="url"
              value={cloudUrl}
              onChange={(e) => setCloudUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="w-full bg-slate-50 border border-slate-300 focus:border-teal-500 rounded-xl py-2 px-3 font-mono text-[11px] outline-none"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">
              مفتاح الحماية السري (Security Key)
            </label>
            <input
              type="password"
              value={cloudKey}
              onChange={(e) => setCloudKey(e.target.value)}
              placeholder="اكتب كلمة السر الخاصة بك في السكربت..."
              className="w-full bg-slate-50 border border-slate-300 focus:border-teal-500 rounded-xl py-2 px-3 font-mono text-xs outline-none"
            />
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
            <button
              onClick={handleCloudUpload}
              disabled={isCloudBusy}
              className={`w-full sm:w-auto font-bold px-4 py-2 rounded-xl shadow transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                isOwner
                  ? 'bg-slate-800 hover:bg-slate-700 text-white'
                  : 'bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300'
              }`}
            >
              {isOwner ? <Cloud className="w-4 h-4" /> : <Lock className="w-4 h-4 text-amber-600" />}
              <span>
                {!isOwner
                  ? 'دخول المالك للرفع عبر Apps Script'
                  : isCloudBusy
                  ? 'جارٍ الرفع...'
                  : 'رفع نسخة عبر Apps Script'}
              </span>
            </button>

            <span className="text-xs text-slate-500 font-semibold">
              الحالة: <strong className="text-slate-800">{cloudStatus}</strong>
            </span>
          </div>
        </div>
      </details>

      {/* App Security & Cloud Device Allowlist Card */}
      <div className="bg-slate-900 text-white p-5 rounded-2xl border border-slate-800 shadow-md space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center border border-teal-500/30">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base text-white">الأمان وحماية السحابة والأجهزة المصرح لها</h2>
              <p className="text-xs text-teal-300/80">تشفير كامل + حظر محركات البحث + قائمة حسابات Google المسموح لها</p>
            </div>
          </div>
          <span className="text-[11px] bg-teal-500/20 text-teal-300 font-bold px-3 py-1 rounded-full border border-teal-500/30 self-start sm:self-auto">
            {cloudAuthStatus === 'authorized' ? 'السحابة محمية ومربوطة ✓' : 'تشفير البوابة نشط'}
          </span>
        </div>

        {/* Cloud Google Link Status */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Mail className="w-4 h-4 text-sky-400" />
                <span>حالة ربط السحابة بحساب Google:</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                {firebaseUser
                  ? `متصل حالياً بالحساب: ${firebaseUser.email} (${isFirebaseOwner ? 'صاحب المتجر 👑' : cloudAuthStatus === 'authorized' ? 'جهاز كاشير مصرح له ✓' : 'غير مصرح ⛔'})`
                  : 'هذا الجهاز غير مربوط بحساب Google بعد. اربط الحساب لتفعيل المزامنة السحابية الآمنة.'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {firebaseUser ? (
                <button
                  type="button"
                  onClick={() => signOutOwner()}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs px-3 py-2 rounded-xl border border-slate-700 cursor-pointer"
                >
                  تسجيل خروج من Google
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => signInWithGoogleForCloud()}
                  className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-black text-xs px-3.5 py-2 rounded-xl cursor-pointer"
                >
                  ربط بحساب Google الآن
                </button>
              )}
            </div>
          </div>

          {/* Authorized Devices / Cashier Emails List (Owner Only) */}
          {isOwner && (
            <div className="pt-3 border-t border-slate-800 space-y-3">
              <div>
                <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4" />
                  <span>الأجهزة وحسابات الموظفين المصرح لها بفتح قاعدة البيانات السحابية</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  لا يمكن لأي شخص على الإنترنت قراءة أو تعديل السحابة إلا بحساب المالك ({OWNER_EMAIL}) أو الحسابات المضافة هنا.
                </p>
              </div>

              {isFirebaseOwner ? (
                <>
                  <form onSubmit={handleAddAuthorizedEmail} className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <input
                      type="email"
                      required
                      dir="ltr"
                      value={newStaffEmail}
                      onChange={(e) => setNewStaffEmail(e.target.value)}
                      placeholder="cashier.email@gmail.com"
                      className="bg-slate-900 border border-slate-700 focus:border-teal-400 rounded-xl px-3 py-2 text-white outline-none font-mono"
                    />
                    <input
                      type="text"
                      maxLength={80}
                      value={newStaffLabel}
                      onChange={(e) => setNewStaffLabel(e.target.value)}
                      placeholder="اسم الجهاز (مثال: جهاز الكاشير)"
                      className="bg-slate-900 border border-slate-700 focus:border-teal-400 rounded-xl px-3 py-2 text-white outline-none"
                    />
                    <button
                      type="submit"
                      disabled={staffBusy}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-2 rounded-xl cursor-pointer disabled:opacity-50"
                    >
                      {staffBusy ? 'جارٍ الإضافة...' : '+ تصريح لهذا الحساب'}
                    </button>
                  </form>

                  {staffStatus && (
                    <p className={`text-xs font-bold ${staffStatus.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {staffStatus.text}
                    </p>
                  )}

                  {authorizedEmails.length > 0 ? (
                    <div className="space-y-1.5">
                      {authorizedEmails.map((rec) => (
                        <div
                          key={rec.email}
                          className="flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-2 text-xs"
                        >
                          <div>
                            <span className="font-mono font-bold text-slate-200">{rec.email}</span>
                            {rec.label && (
                              <span className="mr-2 text-[11px] text-teal-300">({rec.label})</span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setPendingRemoveEmail(rec.email)}
                            className="text-rose-400 hover:text-rose-300 p-1 rounded-lg hover:bg-rose-950/50 cursor-pointer"
                            title="إلغاء صلاحية هذا الحساب"
                            aria-label={`إلغاء صلاحية ${rec.email}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500">
                      لا توجد حسابات كاشير إضافية مضافة حالياً — فقط حساب المالك ({OWNER_EMAIL}) يملك صلاحية فتح السحابة.
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[11px] text-amber-300/90 bg-amber-950/40 border border-amber-800/40 rounded-xl p-2.5">
                  سجّل الدخول بحساب Google الخاص بالمالك ({OWNER_EMAIL}) لتفعيل إضافة أو حذف حسابات الأجهزة الأخرى.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Change External Gate Credentials (Owner Only) */}
        {isOwner && (
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-amber-400" />
                <span>تغيير اسم المستخدم وكلمة مرور البوابة الخارجية</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowGateChange(!showGateChange);
                  setGateChangeStatus(null);
                }}
                className="text-xs font-bold text-teal-300 hover:text-teal-200 cursor-pointer"
              >
                {showGateChange ? 'إغلاق' : 'تعديل كلمة المرور'}
              </button>
            </div>

            {showGateChange && (
              <form onSubmit={handleGateCredentialUpdate} className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs pt-1">
                <input
                  type="password"
                  required
                  dir="ltr"
                  value={gateOldPass}
                  onChange={(e) => setGateOldPass(e.target.value)}
                  placeholder="كلمة المرور الحالية"
                  className="bg-slate-900 border border-slate-700 focus:border-teal-400 rounded-xl px-3 py-2 text-white outline-none font-mono"
                />
                <input
                  type="text"
                  required
                  dir="ltr"
                  value={gateNewUser}
                  onChange={(e) => setGateNewUser(e.target.value)}
                  placeholder="اسم المستخدم الجديد"
                  className="bg-slate-900 border border-slate-700 focus:border-teal-400 rounded-xl px-3 py-2 text-white outline-none font-mono"
                />
                <input
                  type="password"
                  required
                  dir="ltr"
                  value={gateNewPass}
                  onChange={(e) => setGateNewPass(e.target.value)}
                  placeholder="كلمة المرور الجديدة"
                  className="bg-slate-900 border border-slate-700 focus:border-teal-400 rounded-xl px-3 py-2 text-white outline-none font-mono"
                />
                <div className="sm:col-span-3 flex items-center justify-between gap-2 pt-1">
                  {gateChangeStatus ? (
                    <span className={`font-bold ${gateChangeStatus.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {gateChangeStatus.text}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400">تحفظ كلمة المرور الجديدة مشفرة بتقنية scrypt على الخادم.</span>
                  )}
                  <button
                    type="submit"
                    className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black px-4 py-2 rounded-xl cursor-pointer shrink-0"
                  >
                    حفظ بيانات الدخول الجديدة
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {onLockApp && (
          <div className="pt-1 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-slate-400">
              يمكنك قفل البرنامج فوراً في أي وقت عند مغادرة الجهاز:
            </div>
            <button
              type="button"
              onClick={onLockApp}
              className="w-full sm:w-auto bg-rose-600/90 hover:bg-rose-600 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              <span>قفل البرنامج وتأمين الجلسة الآن</span>
            </button>
          </div>
        )}
      </div>

      {/* Danger Zone: Complete Factory Wipe */}
      <div className="bg-rose-50/50 p-5 rounded-2xl border border-rose-200 space-y-4">
        <div className="flex items-center gap-2 text-rose-800 font-bold">
          <AlertTriangle className="w-5 h-5 text-rose-600" />
          <span>منطقة تفريغ المتجر والمسح الشامل</span>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-1">
          <div className="space-y-1">
            <div className="font-bold text-xs text-rose-950">مسح كامل البيانات وتفريغ المتجر</div>
            <p className="text-[11px] text-rose-800 leading-relaxed">
              يحذف <strong>جميع الأصناف بكل أسعارها (القطاعي والجملة والدستة) بكل المجموعات</strong> والفواتير والنواقص من الجهاز والسحابة تماماً (ويُحفظ كل ما تم حذفه احتياطياً في سلة المهملات لمدة 30 يوماً قبل الحذف النهائي).
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!isOwner) {
                setWipeFeedback('🔒 تفريغ ومسح كامل بيانات المتجر متاح حصراً لمالك المتجر برمز المرور السري.');
                onRequestOwnerLogin?.();
                return;
              }
              setWipeFeedback(null);
              setIsWipeModalOpen(true);
            }}
            className="w-full sm:w-auto bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-colors shrink-0 cursor-pointer shadow-xs"
          >
            مسح شامل وتفريغ المتجر
          </button>
        </div>

        {wipeFeedback && (
          <div role="status" className="text-xs font-bold bg-white border border-rose-200 text-rose-900 rounded-xl p-3">
            {wipeFeedback}
          </div>
        )}
      </div>

      {/* Confirm Remove Authorized Staff Email */}
      <ConfirmModal
        isOpen={Boolean(pendingRemoveEmail)}
        title="إلغاء صلاحية الوصول السحابي"
        description={`هل تريد إلغاء صلاحية الوصول السحابي لحساب (${pendingRemoveEmail || ''}) فوراً؟`}
        confirmLabel="نعم، إلغاء الصلاحية"
        isDestructive={true}
        onConfirm={confirmRemoveAuthorizedEmail}
        onCancel={() => setPendingRemoveEmail(null)}
      />

      {/* Confirm Complete Store Wipe */}
      <ConfirmModal
        isOpen={isWipeModalOpen}
        title="تأكيد المسح الشامل وتفريغ المتجر بالكامل"
        description="سيتم مسح جميع الأصناف بكل أسعارها (القطاعي، الجملة، الدستة) بكل المجموعات وجميع الفواتير والنواقص ليصبح المتجر فارغاً تماماً (0 صنف)، مع نقل البيانات المحذوفة إلى سلة المهملات لمدة 30 يوماً."
        confirmLabel="نعم، تفريغ المتجر بالكامل"
        isDestructive={true}
        isLoading={isWipeBusy}
        itemDetails={[
          { label: 'الأصناف التي ستُفرّغ', value: `${db.products.length} صنف بكل مجموعاتها` },
          { label: 'الفواتير / النواقص', value: `${db.invoices.length} فاتورة / ${db.shortages.length} ناقص` },
          { label: 'الحفظ في سلة المهملات', value: 'تبقى محفوظة 30 يوماً' },
        ]}
        onConfirm={async () => {
          setIsWipeBusy(true);
          try {
            await onWipeDatabase();
            setIsWipeModalOpen(false);
            setWipeFeedback('✅ تم تفريغ المتجر بالكامل من جميع الأصناف والأسعار والمجموعات بنجاح، وتم نقل البيانات إلى سلة المهملات لمدة 30 يوماً.');
          } finally {
            setIsWipeBusy(false);
          }
        }}
        onCancel={() => setIsWipeModalOpen(false)}
      />
    </div>
  );
};
