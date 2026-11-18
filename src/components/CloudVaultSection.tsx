import React, { useMemo, useState } from 'react';
import {
  Cloud,
  History,
  Trash2,
  RotateCcw,
  Download,
  RefreshCw,
  ShieldCheck,
  Clock,
  HelpCircle,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Package,
  Receipt,
  ClipboardList,
  Database,
  Mail,
} from 'lucide-react';
import {
  AppDatabase,
  CloudBackupManifest,
  CloudBackupReason,
  TrashEntityType,
  TrashItem,
} from '../types';
import { CloudAuthStatus, OWNER_EMAIL, signInWithGoogleForCloud } from '../services/firebase';
import { GmailDailyBackupMeta } from '../services/gmailBackup';
import { formatDateTime } from '../utils/shopLogic';
import { getDailyBackupDateKey, getTrashRemainingDays, TRASH_RETENTION_DAYS } from '../utils/backupTrashLogic';
import { ConfirmModal } from './ConfirmModal';

interface CloudVaultSectionProps {
  trashItems: TrashItem[];
  isOwner: boolean;
  isCloudAdmin: boolean;
  cloudAuthStatus: CloudAuthStatus;
  cloudBackups: CloudBackupManifest[];
  cloudBackupsLoading: boolean;
  onRequestOwnerLogin?: () => void;
  onCreateManualCloudBackup: () => Promise<CloudBackupManifest>;
  onRestoreCloudBackup: (manifest: CloudBackupManifest) => Promise<AppDatabase>;
  onDownloadCloudBackupJson: (manifest: CloudBackupManifest) => Promise<void>;
  onDeleteCloudBackup: (backupId: string) => Promise<void>;
  onRestoreTrashItem: (item: TrashItem) => void;
  onPermanentDeleteTrashItem: (trashId: string) => void;
  onEmptyTrash: () => void;
  onNavigate?: (tab: string) => void;
  gmailBackupMeta?: GmailDailyBackupMeta;
  gmailBackupBusy?: boolean;
  gmailBackupFeedback?: { ok: boolean; text: string } | null;
  onSendDailyGmailBackup?: () => Promise<void> | void;
  totalProductsCount?: number;
  totalInvoicesCount?: number;
  totalShortagesCount?: number;
  todayDailyBackup?: CloudBackupManifest | null;
}

const REASON_LABELS: Record<CloudBackupReason, { text: string; tone: string }> = {
  auto_daily: { text: 'تلقائية يومية', tone: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30' },
  manual: { text: 'حفظ يدوي', tone: 'bg-sky-500/20 text-sky-200 border-sky-400/30' },
  pre_wipe: { text: 'قبل التفريغ الشامل', tone: 'bg-amber-500/20 text-amber-200 border-amber-400/30' },
  pre_restore: { text: 'قبل الاستعادة', tone: 'bg-indigo-500/20 text-indigo-200 border-indigo-400/30' },
};

const ENTITY_BADGES: Record<TrashEntityType, { label: string; color: string; Icon: React.FC<{ className?: string }> }> = {
  product: { label: 'صنف', color: 'bg-blue-50 text-blue-700 border-blue-200', Icon: Package },
  invoice: { label: 'فاتورة', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: Receipt },
  shortage: { label: 'ناقص', color: 'bg-amber-50 text-amber-700 border-amber-200', Icon: ClipboardList },
};

export const CloudVaultSection: React.FC<CloudVaultSectionProps> = ({
  trashItems,
  isOwner,
  isCloudAdmin,
  cloudAuthStatus,
  cloudBackups,
  cloudBackupsLoading,
  onRequestOwnerLogin,
  onCreateManualCloudBackup,
  onRestoreCloudBackup,
  onDownloadCloudBackupJson,
  onDeleteCloudBackup,
  onRestoreTrashItem,
  onPermanentDeleteTrashItem,
  onEmptyTrash,
  onNavigate,
  gmailBackupMeta,
  gmailBackupBusy = false,
  gmailBackupFeedback,
  onSendDailyGmailBackup,
  totalProductsCount = 0,
  totalInvoicesCount = 0,
  totalShortagesCount = 0,
  todayDailyBackup = null,
}) => {
  const [activeVaultTab, setActiveVaultTab] = useState<'backups' | 'trash'>('backups');
  const [trashFilter, setTrashFilter] = useState<'all' | TrashEntityType>('all');
  const [trashDisplayLimit, setTrashDisplayLimit] = useState<number>(40);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [vaultToast, setVaultToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAccessGuide, setShowAccessGuide] = useState(false);

  // Pending modals
  const [confirmRestoreManifest, setConfirmRestoreManifest] = useState<CloudBackupManifest | null>(null);
  const [confirmDeleteManifest, setConfirmDeleteManifest] = useState<CloudBackupManifest | null>(null);
  const [confirmPermDeleteTrash, setConfirmPermDeleteTrash] = useState<TrashItem | null>(null);
  const [confirmEmptyTrashOpen, setConfirmEmptyTrashOpen] = useState(false);
  const [confirmGmailBackupOpen, setConfirmGmailBackupOpen] = useState(false);

  const todayKey = getDailyBackupDateKey();
  const isTodayGmailSent = gmailBackupMeta?.lastSentDateKey === todayKey;

  const filteredTrash = useMemo(() => {
    if (trashFilter === 'all') return trashItems;
    return trashItems.filter((item) => item.entityType === trashFilter);
  }, [trashItems, trashFilter]);

  const trashCounts = useMemo(() => {
    let product = 0;
    let invoice = 0;
    let shortage = 0;
    for (const item of trashItems) {
      if (item.entityType === 'product') product++;
      else if (item.entityType === 'invoice') invoice++;
      else shortage++;
    }
    return { all: trashItems.length, product, invoice, shortage };
  }, [trashItems]);

  const showToast = (ok: boolean, text: string) => {
    setVaultToast({ ok, text });
    setTimeout(() => setVaultToast(null), 5000);
  };

  const handleManualBackupClick = async () => {
    if (!isOwner) {
      onRequestOwnerLogin?.();
      return;
    }
    setBusyActionId('manual-backup');
    try {
      const saved = await onCreateManualCloudBackup();
      showToast(
        true,
        `تم حفظ نسخة سحابية فورية بنجاح (${saved.productCount} صنف · ${saved.categoryCount} مجموعة · ${saved.invoiceCount} فاتورة).`
      );
    } catch (err: unknown) {
      showToast(false, (err as Error)?.message || 'تعذر حفظ النسخة السحابية حالياً.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleConfirmRestoreBackup = async () => {
    if (!confirmRestoreManifest) return;
    setBusyActionId(`restore-${confirmRestoreManifest.id}`);
    try {
      const restored = await onRestoreCloudBackup(confirmRestoreManifest);
      showToast(
        true,
        `تمت استعادة نسخة ${confirmRestoreManifest.label} بنجاح (${restored.products.length} صنف بكامل الأسعار والمجموعات) ومزامنتها سحابياً.`
      );
      setConfirmRestoreManifest(null);
    } catch (err: unknown) {
      showToast(false, (err as Error)?.message || 'تعذر استعادة النسخة من السحابة.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleConfirmDeleteBackup = async () => {
    if (!confirmDeleteManifest) return;
    setBusyActionId(`delete-${confirmDeleteManifest.id}`);
    try {
      await onDeleteCloudBackup(confirmDeleteManifest.id);
      showToast(true, `تم حذف النسخة المؤرخة (${confirmDeleteManifest.label}) من الخزينة السحابية.`);
      setConfirmDeleteManifest(null);
    } catch (err: unknown) {
      showToast(false, (err as Error)?.message || 'تعذر حذف النسخة السحابية.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleDownloadSnapshot = async (manifest: CloudBackupManifest) => {
    if (!isOwner) {
      onRequestOwnerLogin?.();
      return;
    }
    setBusyActionId(`download-${manifest.id}`);
    try {
      await onDownloadCloudBackupJson(manifest);
      showToast(true, `تم تنزيل ملف JSON لنسخة (${manifest.label}).`);
    } catch (err: unknown) {
      showToast(false, (err as Error)?.message || 'تعذر تنزيل النسخة.');
    } finally {
      setBusyActionId(null);
    }
  };

  const canUseCloudVault = isOwner && isCloudAdmin && cloudAuthStatus === 'authorized';

  return (
    <section
      aria-label="خزينة النسخ السحابية اليومية وسلة المهملات"
      className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
    >
      {/* Top Dark Header + Mode Switcher */}
      <div className="bg-gradient-to-l from-slate-900 via-indigo-950 to-slate-900 text-white p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 flex items-center justify-center shrink-0">
              <Cloud className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-black text-white flex items-center gap-2 flex-wrap">
                <span>النسخ السحابية اليومية وسلة المهملات</span>
                {canUseCloudVault ? (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>جهاز المالك: وصول كامل واسترجاع مفعّل</span>
                  </span>
                ) : (
                  <span className="text-[10px] bg-sky-500/20 text-sky-200 border border-sky-400/30 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                    <Cloud className="w-3 h-3" />
                    <span>الحفظ اليومي للسحابة يعمل تلقائياً من هذا الجهاز</span>
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                تحفظ جميع أجهزة المتجر نسخة يومية تلقائياً على السحابة بجميع الأصناف والأسعار والفواتير، بينما الوصول للنسخ واسترجاعها أو الاحتفاظ بنسخة على بريد المالك مخصص لجهاز المالك المسجل بجيميل المالك.
                {todayDailyBackup?.updatedAt && (
                  <span className="block text-[11px] text-emerald-300 font-bold mt-1">
                    ✓ أحدث حفظ سحابي لنسخة اليوم ({todayDailyBackup.dateKey}): {formatDateTime(todayDailyBackup.updatedAt)} ({todayDailyBackup.productCount} صنف · {todayDailyBackup.invoiceCount} فاتورة)
                  </span>
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAccessGuide((v) => !v)}
            className="text-xs font-bold bg-white/10 hover:bg-white/20 text-sky-200 px-3.5 py-2 rounded-xl border border-white/15 flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors self-start sm:self-center"
          >
            <HelpCircle className="w-4 h-4 text-sky-300" />
            <span>{showAccessGuide ? 'إخفاء شرح الوصول' : 'كيف أصل للنسخة السحابية؟'}</span>
          </button>
        </div>

        {/* Sub-Tabs */}
        <div role="tablist" aria-label="أقسام الخزينة السحابية" className="grid grid-cols-2 gap-2 bg-slate-950/60 p-1.5 rounded-xl border border-slate-800">
          <button
            type="button"
            role="tab"
            aria-selected={activeVaultTab === 'backups'}
            onClick={() => setActiveVaultTab('backups')}
            className={`py-2.5 px-3 rounded-lg text-xs font-black flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeVaultTab === 'backups'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-300 hover:bg-slate-800/70'
            }`}
          >
            <History className="w-4 h-4" />
            <span>النسخ السحابية اليومية</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-black/25 font-mono">
              {cloudBackups.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeVaultTab === 'trash'}
            onClick={() => setActiveVaultTab('trash')}
            className={`py-2.5 px-3 rounded-lg text-xs font-black flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeVaultTab === 'trash'
                ? 'bg-rose-600 text-white shadow'
                : 'text-slate-300 hover:bg-slate-800/70'
            }`}
          >
            <Trash2 className="w-4 h-4" />
            <span>سلة المهملات (30 يوم)</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-black/25 font-mono">
              {trashItems.length}
            </span>
          </button>
        </div>
      </div>

      {/* Expandable Guide: How to access Cloud Backups */}
      {showAccessGuide && (
        <div className="bg-sky-50/80 border-b border-sky-200 p-4 sm:p-5 text-xs text-slate-800 space-y-2.5">
          <div className="font-black text-sky-950 flex items-center gap-2 text-sm">
            <Database className="w-4 h-4 text-sky-600" />
            <span>كيف تصل إلى نسختك السحابية من أي جهاز في أي وقت؟</span>
          </div>
          <ol className="list-decimal list-inside space-y-1.5 leading-relaxed text-slate-700 font-medium">
            <li>
              <strong>الحفظ التلقائي على السحابة (من أي جهاز):</strong> يحفظ التطبيق نسخة سحابية يومية تلقائياً إلى الخادم السحابي من أي جهاز مفتوح بالمتجر (سواء جهاز كاشير أو جهاز المالك) لضمان عدم ضياع أي بيانات.
            </li>
            <li>
              <strong>من جيميل المالك وجهاز المالك:</strong> المسجل ببريد المالك (<span dir="ltr" className="font-mono font-bold text-sky-900">{OWNER_EMAIL}</span>) فقط يملك صلاحية استعراض سجل النسخ اليومية واسترجاع أي تاريخ منها أو تنزيلها أو إرسال نسخة يومية إلى Gmail.
            </li>
            <li>
              <strong>من Google Drive الخاص بك:</strong>{' '}
              {onNavigate ? (
                <button
                  type="button"
                  onClick={() => onNavigate('drive')}
                  className="text-teal-700 font-bold underline hover:text-teal-900 cursor-pointer"
                >
                  افتح مركز إدارة Google Drive من هنا
                </button>
              ) : (
                'افتح مركز إدارة Google Drive من القائمة الرئيسية'
              )}{' '}
              لحفظ نسخة إضافية مباشرة على حساب درايف وتنزيلها في أي وقت.
            </li>
          </ol>
        </div>
      )}

      {/* Status Toast */}
      {vaultToast && (
        <div
          role="status"
          className={`mx-5 mt-4 p-3 rounded-xl border text-xs font-bold flex items-center gap-2 ${
            vaultToast.ok
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          {vaultToast.ok ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{vaultToast.text}</span>
        </div>
      )}

      {/* Body Content */}
      <div className="p-5">
        {activeVaultTab === 'backups' ? (
          <div className="space-y-4">
            {/* Action Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5">
              <div className="text-xs text-slate-700 leading-relaxed">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  <span>سجل النسخ الاحتياطية اليومية على السحابة</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  يتم أخذ نسخة تلقائية يومية في الخلفية بجميع الأصناف وأسعار القطاعى والجملة والدستة والمجموعات والفواتير.
                </p>
              </div>

              <button
                type="button"
                onClick={handleManualBackupClick}
                disabled={busyActionId === 'manual-backup'}
                className={`px-4 py-2.5 rounded-xl font-bold text-xs shadow-sm flex items-center justify-center gap-2 shrink-0 cursor-pointer transition-all ${
                  canUseCloudVault
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60'
                    : 'bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300'
                }`}
              >
                <RefreshCw className={`w-4 h-4 ${busyActionId === 'manual-backup' ? 'animate-spin' : ''}`} />
                <span>
                  {busyActionId === 'manual-backup'
                    ? 'جارٍ رفع النسخة...'
                    : canUseCloudVault
                    ? 'حفظ نسخة سحابية فورية الآن'
                    : !isOwner
                    ? 'دخول المالك أولاً للحفظ السحابي'
                    : 'اربط حساب Google لتفعيل الحفظ السحابي'}
                </span>
              </button>
            </div>

            {/* Daily Owner Gmail Backup Card */}
            {onSendDailyGmailBackup && (
              <div className="bg-sky-50/70 border border-sky-200 rounded-xl p-4 space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs space-y-1">
                    <div className="font-black text-sky-950 flex items-center gap-2 flex-wrap">
                      <Mail className="w-4 h-4 text-sky-600 shrink-0" />
                      <span>النسخة اليومية على جيميل المالك (Gmail)</span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                          isTodayGmailSent
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : 'bg-amber-100 text-amber-900 border-amber-200'
                        }`}
                      >
                        {isTodayGmailSent ? 'تم إرسال نسخة اليوم ✓' : 'جاهز لإرسال نسخة اليوم'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      يرسل ملف JSON كاملاً بأصناف وأسعار وفواتير ونواقص المتجر إلى بريد المالك:{' '}
                      <span dir="ltr" className="font-mono font-bold text-sky-900">{OWNER_EMAIL}</span>
                    </p>
                    {gmailBackupMeta?.lastSentAt && (
                      <p className="text-[11px] text-slate-500 font-mono">
                        آخر إرسال ناجح: {formatDateTime(gmailBackupMeta.lastSentAt) || gmailBackupMeta.lastSentDateKey}
                        {typeof gmailBackupMeta.productCount === 'number'
                          ? ` (${gmailBackupMeta.productCount} صنف · ${gmailBackupMeta.invoiceCount ?? 0} فاتورة)`
                          : ''}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={gmailBackupBusy}
                    onClick={() => {
                      if (!isOwner) {
                        onRequestOwnerLogin?.();
                        return;
                      }
                      setConfirmGmailBackupOpen(true);
                    }}
                    className={`min-h-[42px] px-4 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shrink-0 cursor-pointer transition-colors disabled:opacity-60 ${
                      isOwner
                        ? 'bg-sky-700 hover:bg-sky-800 text-white shadow-2xs'
                        : 'bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300'
                    }`}
                  >
                    <Mail className="w-4 h-4" />
                    <span>
                      {gmailBackupBusy
                        ? 'جارٍ الإرسال إلى Gmail...'
                        : !isOwner
                        ? 'دخول المالك لإرسال النسخة'
                        : isTodayGmailSent
                        ? 'إعادة إرسال نسخة اليوم بالبريد'
                        : 'إرسال نسخة اليوم لبريد المالك'}
                    </span>
                  </button>
                </div>

                {gmailBackupFeedback && (
                  <div
                    role="status"
                    className={`text-xs font-bold p-2.5 rounded-lg border ${
                      gmailBackupFeedback.ok
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                    }`}
                  >
                    {gmailBackupFeedback.text}
                  </div>
                )}
              </div>
            )}

            {/* Auth Guard Banner when not linked as Cloud Owner */}
            {!canUseCloudVault && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-amber-950 space-y-1">
                  <div className="font-black flex items-center gap-1.5">
                    <Lock className="w-4 h-4 text-amber-600" />
                    <span>استعراض واسترجاع النسخ السحابية مخصص لجهاز المالك فقط</span>
                  </div>
                  <p className="text-[11px] text-amber-800">
                    {!isOwner
                      ? 'الحفظ اليومي للسحابة يعمل تلقائياً من جميع الأجهزة، بينما استعراض النسخ واسترجاعها أو إرسال نسخة لجيميل المالك يتطلب تفعيل وضع المالك وربط جيميل المالك.'
                      : `اربط حساب جيميل المالك (${OWNER_EMAIL}) لعرض تاريخ النسخ السحابية واسترجاعها أو الاحتفاظ بنسخة على بريدك.`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!isOwner && (
                    <button
                      type="button"
                      onClick={() => onRequestOwnerLogin?.()}
                      className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl cursor-pointer"
                    >
                      دخول وضع المالك
                    </button>
                  )}
                  {cloudAuthStatus !== 'authorized' && (
                    <button
                      type="button"
                      onClick={() => signInWithGoogleForCloud()}
                      className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-3.5 py-2 rounded-xl cursor-pointer"
                    >
                      ربط حساب Google
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Backups List */}
            {canUseCloudVault && cloudBackupsLoading ? (
              <div className="text-center py-8 text-xs text-slate-500 flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                <span>جارٍ تحميل قائمة النسخ السحابية المحفوظة...</span>
              </div>
            ) : canUseCloudVault && cloudBackups.length === 0 ? (
              <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-300 space-y-2">
                <Cloud className="w-8 h-8 text-slate-400 mx-auto" />
                <div className="text-sm font-bold text-slate-700">لا توجد نسخ يومية محفوظة بعد</div>
                <p className="text-xs text-slate-500">
                  اضغط «حفظ نسخة سحابية فورية الآن» لإنشاء أول نسخة على السحابة بتاريخ اليوم، وسيواصل النظام حفظ نسخة يومياً تلقائياً.
                </p>
              </div>
            ) : (
              canUseCloudVault && (
                <div className="space-y-2.5">
                  {cloudBackups.map((manifest) => {
                    const reasonBadge = REASON_LABELS[manifest.reason] || REASON_LABELS.auto_daily;
                    const isRestoring = busyActionId === `restore-${manifest.id}`;
                    const isDownloading = busyActionId === `download-${manifest.id}`;

                    return (
                      <div
                        key={manifest.id}
                        className="bg-slate-50/90 hover:bg-slate-100/70 border border-slate-200 rounded-xl p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition-colors"
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-black text-sm text-slate-900">{manifest.label}</span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                manifest.reason === 'auto_daily'
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                  : manifest.reason === 'pre_wipe'
                                  ? 'bg-amber-100 text-amber-800 border-amber-200'
                                  : manifest.reason === 'pre_restore'
                                  ? 'bg-indigo-100 text-indigo-800 border-indigo-200'
                                  : 'bg-sky-100 text-sky-800 border-sky-200'
                              }`}
                            >
                              {reasonBadge.text}
                            </span>
                            <span className="text-[11px] font-mono text-slate-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              <span>آخر تحديث: {formatDateTime(manifest.updatedAt) || manifest.dateKey}</span>
                            </span>
                          </div>

                          <div className="flex items-center gap-3 flex-wrap text-xs text-slate-700 font-semibold">
                            <span className="bg-white px-2.5 py-0.5 rounded-lg border border-slate-200">
                              📦 <strong className="font-mono text-slate-900">{manifest.productCount}</strong> صنف
                            </span>
                            <span className="bg-white px-2.5 py-0.5 rounded-lg border border-slate-200">
                              🗂️ <strong className="font-mono text-slate-900">{manifest.categoryCount}</strong> مجموعة
                            </span>
                            <span className="bg-white px-2.5 py-0.5 rounded-lg border border-slate-200">
                              🧾 <strong className="font-mono text-slate-900">{manifest.invoiceCount}</strong> فاتورة
                            </span>
                            <span className="bg-white px-2.5 py-0.5 rounded-lg border border-slate-200">
                              📝 <strong className="font-mono text-slate-900">{manifest.shortageCount}</strong> نواقص
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap shrink-0">
                          <button
                            type="button"
                            onClick={() => setConfirmRestoreManifest(manifest)}
                            disabled={Boolean(busyActionId)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <RotateCcw className={`w-3.5 h-3.5 ${isRestoring ? 'animate-spin' : ''}`} />
                            <span>{isRestoring ? 'جارٍ الاسترجاع...' : 'استرجاع هذه النسخة'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDownloadSnapshot(manifest)}
                            disabled={Boolean(busyActionId)}
                            aria-label={`تصدير ${manifest.label} بصيغة JSON`}
                            className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-bold text-xs px-3 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <Download className="w-3.5 h-3.5 text-blue-600" />
                            <span>{isDownloading ? 'جارٍ التحميل...' : 'ملف JSON'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setConfirmDeleteManifest(manifest)}
                            disabled={Boolean(busyActionId)}
                            aria-label={`حذف النسخة ${manifest.label}`}
                            className="bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 font-bold text-xs p-2 rounded-xl cursor-pointer disabled:opacity-50"
                            title="حذف هذه النسخة السحابية"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>
        ) : (
          /* 30-Day Soft-Delete Trash Bin Tab */
          <div className="space-y-4">
            {/* Filter & Empty Trash Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                {(
                  [
                    { id: 'all', label: `الكل (${trashCounts.all})` },
                    { id: 'product', label: `الأصناف (${trashCounts.product})` },
                    { id: 'invoice', label: `الفواتير (${trashCounts.invoice})` },
                    { id: 'shortage', label: `النواقص (${trashCounts.shortage})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setTrashFilter(tab.id);
                      setTrashDisplayLimit(40);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      trashFilter === tab.id
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {trashItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (!isOwner) {
                      onRequestOwnerLogin?.();
                      return;
                    }
                    setConfirmEmptyTrashOpen(true);
                  }}
                  className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs px-3 py-1.5 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>إفراغ السلة نهائياً</span>
                </button>
              )}
            </div>

            {/* Trash List */}
            {filteredTrash.length === 0 ? (
              <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-300 space-y-2">
                <Trash2 className="w-8 h-8 text-slate-400 mx-auto" />
                <div className="text-sm font-bold text-slate-700">سلة المهملات فارغة حالياً</div>
                <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                  عند حذف أي صنف أو فاتورة أو ناقص أو تفريغ المتجر، تنتقل البيانات المحذوفة هنا وتبقى محفوظة لمدة {TRASH_RETENTION_DAYS} يوماً لإمكانية استرجاعها بالكامل قبل الحذف النهائي التلقائي.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-0.5">
                {filteredTrash.slice(0, trashDisplayLimit).map((item) => {
                  const badge = ENTITY_BADGES[item.entityType];
                  const Icon = badge.Icon;
                  const daysLeft = getTrashRemainingDays(item);

                  return (
                    <div
                      key={item.id}
                      className="bg-slate-50/80 hover:bg-slate-100/70 border border-slate-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 ${badge.color}`}>
                            <Icon className="w-3 h-3" />
                            <span>{badge.label}</span>
                          </span>
                          <span className="font-bold text-sm text-slate-900">{item.title}</span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              daysLeft <= 5
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : 'bg-amber-50 text-amber-800 border-amber-200'
                            }`}
                          >
                            متبقي {daysLeft} يوم قبل الحذف النهائي
                          </span>
                        </div>
                        {item.subtitle && (
                          <p className="text-xs text-slate-600 font-medium">{item.subtitle}</p>
                        )}
                        <div className="text-[11px] text-slate-400 font-mono">
                          تاريخ الحذف: {formatDateTime(item.deletedAt) || item.deletedAt}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (!isOwner) {
                              onRequestOwnerLogin?.();
                              return;
                            }
                            onRestoreTrashItem(item);
                            showToast(true, `تم استرجاع «${item.title}» إلى المتجر بكامل بياناته وأسعاره بنجاح.`);
                          }}
                          aria-label={`استرجاع ${item.title}`}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-2xs"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>استرجاع للمتجر</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (!isOwner) {
                              onRequestOwnerLogin?.();
                              return;
                            }
                            setConfirmPermDeleteTrash(item);
                          }}
                          aria-label={`حذف نهائي ${item.title}`}
                          className="bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 font-bold text-xs px-3 py-2 rounded-xl cursor-pointer"
                        >
                          حذف نهائي
                        </button>
                      </div>
                    </div>
                  );
                })}
                {filteredTrash.length > trashDisplayLimit && (
                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => setTrashDisplayLimit((prev) => prev + 40)}
                      className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-4 py-2 rounded-xl cursor-pointer shadow-2xs"
                    >
                      عرض المزيد ({filteredTrash.length - trashDisplayLimit} عنصر متبقي في السلة)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm Restore Dated Cloud Backup */}
      <ConfirmModal
        isOpen={Boolean(confirmRestoreManifest)}
        title="استرجاع النسخة السحابية"
        description={`سيتم استرجاع جميع الأصناف وأسعارها (القطاعي والجملة والدستة) والمجموعات والفواتير والنواقص من تاريخ (${confirmRestoreManifest?.label || ''}) ومزامنتها لجميع الأجهزة.`}
        confirmLabel="نعم، استرجاع النسخة الآن"
        isDestructive={false}
        isLoading={Boolean(confirmRestoreManifest && busyActionId === `restore-${confirmRestoreManifest.id}`)}
        itemDetails={
          confirmRestoreManifest
            ? [
                { label: 'التاريخ والنسخة', value: confirmRestoreManifest.label },
                { label: 'عدد الأصناف', value: `${confirmRestoreManifest.productCount} صنف` },
                { label: 'عدد المجموعات', value: `${confirmRestoreManifest.categoryCount} مجموعة` },
                { label: 'الفواتير / النواقص', value: `${confirmRestoreManifest.invoiceCount} فاتورة / ${confirmRestoreManifest.shortageCount} ناقص` },
              ]
            : undefined
        }
        onConfirm={handleConfirmRestoreBackup}
        onCancel={() => setConfirmRestoreManifest(null)}
      />

      {/* Confirm Delete Dated Cloud Backup */}
      <ConfirmModal
        isOpen={Boolean(confirmDeleteManifest)}
        title="حذف نسخة سحابية محفوظة"
        description={`هل تريد حذف النسخة المحفوظة بتاريخ (${confirmDeleteManifest?.label || ''}) من الخزينة السحابية؟`}
        confirmLabel="حذف النسخة"
        isDestructive={true}
        isLoading={Boolean(confirmDeleteManifest && busyActionId === `delete-${confirmDeleteManifest.id}`)}
        onConfirm={handleConfirmDeleteBackup}
        onCancel={() => setConfirmDeleteManifest(null)}
      />

      {/* Confirm Permanent Delete Trash Item */}
      <ConfirmModal
        isOpen={Boolean(confirmPermDeleteTrash)}
        title="حذف نهائي من سلة المهملات"
        description={`سيتم حذف «${confirmPermDeleteTrash?.title || ''}» نهائياً ولن يمكن استرجاعه من السلة بعد الآن.`}
        confirmLabel="حذف نهائي"
        isDestructive={true}
        onConfirm={() => {
          if (confirmPermDeleteTrash) {
            onPermanentDeleteTrashItem(confirmPermDeleteTrash.id);
            showToast(true, `تم الحذف النهائي لعنصر «${confirmPermDeleteTrash.title}».`);
            setConfirmPermDeleteTrash(null);
          }
        }}
        onCancel={() => setConfirmPermDeleteTrash(null)}
      />

      {/* Confirm Empty Entire Trash */}
      <ConfirmModal
        isOpen={confirmEmptyTrashOpen}
        title="إفراغ سلة المهملات نهائياً"
        description={`سيتم حذف جميع العناصر الموجودة في سلة المهملات (${trashItems.length} عنصر) نهائياً من الجهاز والسحابة.`}
        confirmLabel="إفراغ السلة بالكامل"
        isDestructive={true}
        onConfirm={() => {
          onEmptyTrash();
          setConfirmEmptyTrashOpen(false);
          showToast(true, 'تم إفراغ سلة المهملات نهائياً.');
        }}
        onCancel={() => setConfirmEmptyTrashOpen(false)}
      />

      {/* Confirm Send Daily Store Backup via Gmail */}
      <ConfirmModal
        isOpen={confirmGmailBackupOpen}
        title="إرسال النسخة الاحتياطية اليومية لبريد المالك (Gmail)"
        description={`هل تريد إرسال نسخة كاملة من بيانات المتجر بتاريخ (${todayKey}) كملف JSON مرفق إلى بريد المالك المعتمد؟`}
        confirmLabel="نعم، إرسال إلى Gmail الآن"
        isDestructive={false}
        isLoading={gmailBackupBusy}
        itemDetails={[
          { label: 'البريد المستلم', value: OWNER_EMAIL },
          { label: 'تاريخ النسخة', value: todayKey },
          { label: 'البيانات المرفقة', value: `${totalProductsCount} صنف · ${totalInvoicesCount} فاتورة · ${totalShortagesCount} ناقص` },
        ]}
        onConfirm={async () => {
          if (onSendDailyGmailBackup) {
            await onSendDailyGmailBackup();
          }
          setConfirmGmailBackupOpen(false);
        }}
        onCancel={() => setConfirmGmailBackupOpen(false)}
      />
    </section>
  );
};
