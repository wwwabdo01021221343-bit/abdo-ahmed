import React, { useState, useEffect, useRef } from 'react';
import { AppDatabase, CartItem, CloudBackupManifest, Invoice, Product, ShortageItem, StoreSettings, TrashItem } from './types';
import { 
  getStoredDataWithMeta,
  saveStoredSlice,
  saveStoredData,
  loadAllSlicesFromIndexedCache,
  enablePersistentStorage,
  exportDataAsJsonFile,
  isExplicitEmptyCatalog,
  markExplicitEmptyCatalog
} from './data/storage';
import { 
  testFirestoreConnection,
  subscribeToAuth,
  subscribeToProducts,
  subscribeToShortages,
  subscribeToInvoices,
  subscribeToStoreSettings,
  subscribeToTrashBin,
  subscribeToCloudBackups,
  cloudBatchSeedProducts,
  cloudGetDailyBackupManifest,
  cloudSaveBackupSnapshot,
  cloudLoadBackupSnapshot,
  cloudDeleteBackupSnapshot,
  checkCurrentUserCloudAuthorization,
  signInWithGoogleForCloud,
  signOutOwner,
  forceCloudSyncRefresh,
  OWNER_EMAIL,
  CloudAuthStatus
} from './services/firebase';
import type { User } from 'firebase/auth';
import {
  enqueueSyncOp,
  enqueueBatchDeleteShortages,
  flushOfflineOutbox,
  getPendingOutboxOps,
  hasPendingOutboxKey,
  markCloudSyncCompleted,
  setOfflineSyncCloudAdmin,
  useSyncStatus,
  waitForOutboxReady
} from './services/offlineSync';
import { getAccessToken, getCachedUserEmail, googleSignIn } from './services/googleAuth';
import {
  GmailDailyBackupMeta,
  readGmailDailyBackupMeta,
  sendDailyBackupViaGmail,
} from './services/gmailBackup';
import { applyPendingOutboxOverlays, readLastSyncInfo } from './utils/syncLogic';
import { buildWhatsAppUrl } from './utils/shopLogic';
import { clearGateTokens } from './utils/cryptoAuth';
import { Header } from './components/Header';
import { PWAInstallBanner } from './components/PWAInstallBanner';
import { Dashboard } from './components/Dashboard';
import { POSView } from './components/POSView';
import { ProductsView } from './components/ProductsView';
import { ShortagesView } from './components/ShortagesView';
import { PrintCatalogView } from './components/PrintCatalogView';
import { SettingsView } from './components/SettingsView';
import { GoogleDriveView } from './components/GoogleDriveView';
import { PriceCheckView } from './components/PriceCheckView';
import { OwnerLoginModal } from './components/OwnerLoginModal';
import { ConfirmModal } from './components/ConfirmModal';
import { SecurityGate, APP_GATE_STORAGE_KEY } from './components/SecurityGate';
import { StartupSyncSplash, StartupSyncRefreshResult } from './components/StartupSyncSplash';
import { normalizeArabicText } from './utils/shopLogic';
import {
  buildDailyBackupId,
  createTrashItem,
  filterActiveTrashItems,
  getDailyBackupDateKey,
  getExpiredTrashIds,
  restoreItemFromTrash,
  shouldPromptDailyGmailBackup,
  shouldTriggerAutoDailyBackup,
} from './utils/backupTrashLogic';
import { soundFx } from './utils/audioFeedback';

export default function App() {
  const initialStoredRef = useRef(getStoredDataWithMeta());
  const [db, setDb] = useState<AppDatabase>(() => initialStoredRef.current.db);
  const hasRealLocalOrCloudDataRef = useRef<boolean>(!initialStoredRef.current.isSeedFallback);
  const hasUserMutatedRef = useRef<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('home');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  // Mobile Back Button & Double-Back to Exit Support
  const [exitToastMessage, setExitToastMessage] = useState<string | null>(null);
  const lastBackPressTimeRef = useRef<number>(0);
  const exitToastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activeTabRef = useRef<string>(activeTab);
  const selectedInvoiceRef = useRef<Invoice | null>(selectedInvoice);
  const isOwnerModalOpenRef = useRef<boolean>(false);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    selectedInvoiceRef.current = selectedInvoice;
  }, [selectedInvoice]);

  const handleNavigate = (tab: string) => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      window.history.pushState({ tab, time: Date.now() }, '', '#' + tab);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Master Security Gate State
  const [isAppUnlocked, setIsAppUnlocked] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    localStorage.removeItem('tayeb_app_gate_unlocked');
    sessionStorage.removeItem('tayeb_app_gate_unlocked');
    return (
      localStorage.getItem(APP_GATE_STORAGE_KEY) === 'true' ||
      sessionStorage.getItem(APP_GATE_STORAGE_KEY) === 'true'
    );
  });

  const [showStartupSplash, setShowStartupSplash] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('no_splash') !== '1';
  });

  const handleUnlockApp = (remember: boolean) => {
    setIsAppUnlocked(true);
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('no_splash') !== '1') {
      setShowStartupSplash(true);
    }
    if (remember) {
      localStorage.setItem(APP_GATE_STORAGE_KEY, 'true');
    } else {
      sessionStorage.setItem(APP_GATE_STORAGE_KEY, 'true');
    }
  };

  const handleLockApp = () => {
    setIsAppUnlocked(false);
    setIsOwner(false);
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('no_splash') !== '1') {
      setShowStartupSplash(true);
    }
    clearGateTokens();
  };

  // Store Owner Role State & Login Modal
  const [isOwner, setIsOwner] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('tayeb_owner_unlocked') === 'true';
  });
  const [isOwnerModalOpen, setIsOwnerModalOpen] = useState<boolean>(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [cloudAuthStatus, setCloudAuthStatus] = useState<CloudAuthStatus>('checking');
  const [isCloudAdmin, setIsCloudAdmin] = useState<boolean>(false);
  const [cloudBackups, setCloudBackups] = useState<CloudBackupManifest[]>([]);
  const [cloudBackupsLoading, setCloudBackupsLoading] = useState<boolean>(false);
  const [todayDailyBackup, setTodayDailyBackup] = useState<CloudBackupManifest | null>(null);
  const [dailyManifestCheckedDate, setDailyManifestCheckedDate] = useState<string | null>(null);
  const [cloudBannerBusy, setCloudBannerBusy] = useState<boolean>(false);
  const [cloudBannerError, setCloudBannerError] = useState<string | null>(null);
  const [gmailBackupMeta, setGmailBackupMeta] = useState<GmailDailyBackupMeta>(() => readGmailDailyBackupMeta());
  const [gmailBackupBusy, setGmailBackupBusy] = useState<boolean>(false);
  const [gmailBackupFeedback, setGmailBackupFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [isGmailDailyPromptModalOpen, setIsGmailDailyPromptModalOpen] = useState<boolean>(false);
  const [dismissedDailyGmailBanner, setDismissedDailyGmailBanner] = useState<boolean>(false);
  const autoDailyBackupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCloudPullRecordRef = useRef<number>(0);
  const authReadyRef = useRef<boolean>(authReady);
  const cloudAuthStatusRef = useRef<CloudAuthStatus>(cloudAuthStatus);
  const isCloudAdminRef = useRef<boolean>(isCloudAdmin);
  const authWaitersRef = useRef<Array<() => void>>([]);

  authReadyRef.current = authReady;
  cloudAuthStatusRef.current = cloudAuthStatus;
  isCloudAdminRef.current = isCloudAdmin;

  useEffect(() => {
    setOfflineSyncCloudAdmin(isCloudAdmin);
    if (isCloudAdmin && navigator.onLine) {
      flushOfflineOutbox(true).catch(() => {});
    }
  }, [isCloudAdmin]);

  useEffect(() => {
    if (authReady && authWaitersRef.current.length > 0) {
      const waiters = authWaitersRef.current.splice(0, authWaitersRef.current.length);
      waiters.forEach((resolve) => resolve());
    }
  }, [authReady]);

  const syncStatus = useSyncStatus();
  const isCloudSynced =
    syncStatus.isOnline &&
    syncStatus.pendingCount === 0 &&
    !syncStatus.isSyncing;

  // Live ref for current database state (avoids React 19 deferred updater race bugs)
  const dbRef = useRef<AppDatabase>(db);
  dbRef.current = db;

  // Debounce timers for rapid shortage quantity clicks
  const qtySyncTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    isOwnerModalOpenRef.current = isOwnerModalOpen;
  }, [isOwnerModalOpen]);

  // Ref to avoid infinite feedback loops
  const isInitialCloudLoad = useRef<boolean>(true);

  // 1. Initial boot: enable persistent storage, hydrate ALL local IndexedDB slices, and track Firebase Auth state
  useEffect(() => {
    enablePersistentStorage();
    loadAllSlicesFromIndexedCache()
      .then((cached) => {
        if (!cached || !isInitialCloudLoad.current || hasUserMutatedRef.current) return;
        hasRealLocalOrCloudDataRef.current = true;
        const expiredIds = getExpiredTrashIds(cached.trash || []);
        if (expiredIds.length > 0) {
          enqueueSyncOp({
            key: `trash:purge:${Date.now()}`,
            type: 'batchDeleteTrashItems',
            ids: expiredIds,
          });
        }
        setDb((prev) => {
          const useCachedAll = initialStoredRef.current.isSeedFallback;
          const nextProducts =
            cached.products &&
            (isExplicitEmptyCatalog() ||
              (cached.products.length > 0 && (useCachedAll || cached.products.length >= prev.products.length)))
              ? cached.products
              : prev.products;
          const nextInvoices =
            cached.invoices && (useCachedAll || cached.invoices.length > prev.invoices.length)
              ? cached.invoices
              : prev.invoices;
          const nextShortages =
            cached.shortages && (useCachedAll || cached.shortages.length > prev.shortages.length)
              ? cached.shortages
              : prev.shortages;
          const nextSettings =
            cached.settings && useCachedAll
              ? cached.settings
              : prev.settings;
          const activeCachedTrash = filterActiveTrashItems(cached.trash || prev.trash || []);
          return {
            products: nextProducts,
            invoices: nextInvoices,
            shortages: nextShortages,
            settings: nextSettings,
            trash: activeCachedTrash,
          };
        });
      })
      .catch(() => {});

    let active = true;
    const unsubAuth = subscribeToAuth(async (user, isUserOwner) => {
      if (!active) return;
      setFirebaseUser(user);
      if (!user) {
        setCloudAuthStatus('unauthenticated');
        setIsCloudAdmin(false);
        setCloudBackups([]);
        setAuthReady(true);
        return;
      }

      setCloudAuthStatus('checking');
      const authCheck = await checkCurrentUserCloudAuthorization(user);
      if (!active) return;
      setCloudAuthStatus(authCheck.status);
      setIsCloudAdmin(Boolean(isUserOwner || authCheck.isOwner));
      setAuthReady(true);
      if (isUserOwner || authCheck.isOwner) {
        setIsOwner(true);
        localStorage.setItem('tayeb_owner_unlocked', 'true');
      }
    });

    return () => {
      active = false;
      unsubAuth();
    };
  }, []);

  // 2. Store Firestore Listeners (Collaborative sync for all unlocked devices; Vault & Trash strictly for Owner)
  useEffect(() => {
    if (!isAppUnlocked || !authReady) {
      return;
    }

    let cancelled = false;
    let unsubProducts: (() => void) | undefined;
    let unsubShortages: (() => void) | undefined;
    let unsubSettings: (() => void) | undefined;
    let unsubInvoices: (() => void) | undefined;
    let unsubTrash: (() => void) | undefined;
    let unsubBackups: (() => void) | undefined;

    (async () => {
      await waitForOutboxReady();
      if (cancelled) return;

      testFirestoreConnection().catch(() => {});
      flushOfflineOutbox(true).catch(() => {});

      const noteCloudSnapshotSynced = (meta: { fromCache: boolean; hasPendingWrites: boolean }, currentDb: AppDatabase) => {
        if (!meta.fromCache && !meta.hasPendingWrites && navigator.onLine) {
          const now = Date.now();
          if (now - lastCloudPullRecordRef.current > 4000) {
            lastCloudPullRecordRef.current = now;
            markCloudSyncCompleted('cloud_pull', {
              productCount: currentDb.products.length,
              invoiceCount: currentDb.invoices.length,
              shortageCount: currentDb.shortages.length,
            });
          }
        }
      };

      // Real-time Firestore Products Listener (protects pending offline ops from being overwritten)
      unsubProducts = subscribeToProducts(
        (cloudProducts, meta) => {
          if (hasPendingOutboxKey('batch:products') || hasPendingOutboxKey('wipe:store')) {
            isInitialCloudLoad.current = false;
            return;
          }
          const pendingOps = getPendingOutboxOps();
          const resolvedProducts =
            pendingOps.length > 0
              ? applyPendingOutboxOverlays({ ...dbRef.current, products: cloudProducts }, pendingOps).products
              : cloudProducts;

          if (resolvedProducts && resolvedProducts.length > 0) {
            markExplicitEmptyCatalog(false);
            hasRealLocalOrCloudDataRef.current = true;
            const nextDb = { ...dbRef.current, products: resolvedProducts };
            setDb((prev) => ({
              ...prev,
              products: resolvedProducts,
            }));
            isInitialCloudLoad.current = false;
            noteCloudSnapshotSynced(meta, nextDb);
          } else if (isInitialCloudLoad.current && !meta.fromCache && navigator.onLine) {
            isInitialCloudLoad.current = false;
            if (!isCloudAdminRef.current || isExplicitEmptyCatalog()) return;
            const currentLocal = dbRef.current;
            if (hasRealLocalOrCloudDataRef.current && currentLocal.products && currentLocal.products.length > 0) {
              cloudBatchSeedProducts(currentLocal.products).catch((err) => {
                console.warn('Initial products seed note:', err);
              });
            }
          } else if (!meta.fromCache && resolvedProducts.length === 0 && isExplicitEmptyCatalog()) {
            setDb((prev) => (prev.products.length > 0 ? { ...prev, products: [] } : prev));
            noteCloudSnapshotSynced(meta, { ...dbRef.current, products: [] });
          }
        },
        (err) => {
          console.warn('Products listener running in offline-first mode:', err);
        }
      );

      // Real-time Firestore Shortages Listener
      unsubShortages = subscribeToShortages(
        (cloudShortages, meta) => {
          if (hasPendingOutboxKey('batch:shortages') || hasPendingOutboxKey('wipe:store')) return;
          if (!cloudShortages || !Array.isArray(cloudShortages)) return;
          if (meta.fromCache && cloudShortages.length === 0 && !navigator.onLine) return;
          const pendingOps = getPendingOutboxOps();
          const resolvedShortages =
            pendingOps.length > 0
              ? applyPendingOutboxOverlays({ ...dbRef.current, shortages: cloudShortages }, pendingOps).shortages
              : cloudShortages;
          if (resolvedShortages.length > 0) hasRealLocalOrCloudDataRef.current = true;
          setDb((prev) => ({
            ...prev,
            shortages: resolvedShortages,
          }));
          noteCloudSnapshotSynced(meta, { ...dbRef.current, shortages: resolvedShortages });
        },
        (err) => {
          console.warn('Shortages listener running offline-first:', err);
        }
      );

      // Real-time Firestore Store Settings Listener
      unsubSettings = subscribeToStoreSettings(
        (cloudSettings, meta) => {
          if (hasPendingOutboxKey('settings:main')) return;
          if (cloudSettings && cloudSettings.shop) {
            hasRealLocalOrCloudDataRef.current = true;
            setDb((prev) => ({
              ...prev,
              settings: {
                ...prev.settings,
                ...cloudSettings,
              },
            }));
            noteCloudSnapshotSynced(meta, dbRef.current);
          }
        },
        (err) => {
          console.warn('Settings listener running offline-first:', err);
        }
      );

      // Real-time Firestore Invoices Listener
      unsubInvoices = subscribeToInvoices(
        (cloudInvoices, meta) => {
          if (hasPendingOutboxKey('batch:invoices') || hasPendingOutboxKey('wipe:store')) return;
          if (!cloudInvoices || !Array.isArray(cloudInvoices)) return;
          if (meta.fromCache && cloudInvoices.length === 0 && !navigator.onLine) return;
          const pendingOps = getPendingOutboxOps();
          const resolvedInvoices =
            pendingOps.length > 0
              ? applyPendingOutboxOverlays({ ...dbRef.current, invoices: cloudInvoices }, pendingOps).invoices
              : cloudInvoices;
          if (resolvedInvoices.length > 0) hasRealLocalOrCloudDataRef.current = true;
          setDb((prev) => ({
            ...prev,
            invoices: resolvedInvoices,
          }));
          noteCloudSnapshotSynced(meta, { ...dbRef.current, invoices: resolvedInvoices });
        },
        (err) => {
          console.warn('Invoices listener running offline-first:', err);
        }
      );

      // Owner-Only Cloud Vault Listeners: 30-Day Trash Bin & Daily Backups
      if (isCloudAdmin) {
        setCloudBackupsLoading(true);
        unsubTrash = subscribeToTrashBin(
          (cloudTrash, meta) => {
            if (hasPendingOutboxKey('wipe:trash_save')) return;
            if (meta.fromCache && cloudTrash.length === 0 && !navigator.onLine) return;
            const pendingOps = getPendingOutboxOps();
            const overlaidTrash =
              pendingOps.length > 0
                ? applyPendingOutboxOverlays({ ...dbRef.current, trash: cloudTrash }, pendingOps).trash || []
                : cloudTrash;
            const expiredIds = getExpiredTrashIds(overlaidTrash);
            if (expiredIds.length > 0) {
              enqueueSyncOp({
                key: `trash:auto_purge_${Date.now()}`,
                type: 'batchDeleteTrashItems',
                ids: expiredIds,
              });
            }
            const activeTrash = filterActiveTrashItems(overlaidTrash);
            setDb((prev) => ({
              ...prev,
              trash: activeTrash,
            }));
          },
          (err) => {
            console.warn('Trash bin listener note:', err);
          }
        );

        unsubBackups = subscribeToCloudBackups(
          (manifests) => {
            setCloudBackups(manifests);
            setCloudBackupsLoading(false);
          },
          (err) => {
            console.warn('Cloud backups listener note:', err);
            setCloudBackupsLoading(false);
          }
        );
      }
    })();

    return () => {
      cancelled = true;
      unsubProducts?.();
      unsubShortages?.();
      unsubSettings?.();
      unsubInvoices?.();
      unsubTrash?.();
      unsubBackups?.();
    };
  }, [isAppUnlocked, authReady, firebaseUser, cloudAuthStatus, isCloudAdmin]);

  // Unified Cloud Refresh Handler (used by StartupSyncSplash on launch + Dashboard/Settings manual sync buttons)
  const runFullCloudRefresh = async (): Promise<StartupSyncRefreshResult> => {
    await waitForOutboxReady();

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return {
        outcome: 'offline',
        syncedAt: readLastSyncInfo().lastSyncAt,
        productCount: dbRef.current.products.length,
        invoiceCount: dbRef.current.invoices.length,
        shortageCount: dbRef.current.shortages.length,
      };
    }

    if (!authReadyRef.current) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1200);
        authWaitersRef.current.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    await flushOfflineOutbox(true).catch(() => {});

    const pullRes = await forceCloudSyncRefresh({
      isCloudAdmin: isCloudAdminRef.current,
    });

    if (!pullRes.ok) {
      return {
        outcome: pullRes.reason === 'offline' ? 'offline' : 'error',
        syncedAt: readLastSyncInfo().lastSyncAt,
        productCount: dbRef.current.products.length,
        invoiceCount: dbRef.current.invoices.length,
        shortageCount: dbRef.current.shortages.length,
        message:
          pullRes.reason === 'timeout'
            ? 'استغرق الخادم وقتاً أطول — تم التشغيل بأحدث بيانات محفوظة'
            : 'تعذر الوصول للسحابة مؤقتاً — تم التشغيل بالبيانات المحفوظة',
      };
    }

    const pendingOps = getPendingOutboxOps();
    const current = dbRef.current;
    const mergedBase: AppDatabase = {
      products:
        (pullRes.products && pullRes.products.length > 0) || isExplicitEmptyCatalog()
          ? pullRes.products || []
          : current.products,
      shortages: pullRes.shortages ?? current.shortages,
      invoices: pullRes.invoices ?? current.invoices,
      settings: pullRes.settings ? { ...current.settings, ...pullRes.settings } : current.settings,
      trash:
        pullRes.trash !== undefined
          ? filterActiveTrashItems(pullRes.trash)
          : current.trash || [],
    };

    const reconciled =
      pendingOps.length > 0 ? applyPendingOutboxOverlays(mergedBase, pendingOps) : mergedBase;

    hasRealLocalOrCloudDataRef.current = true;
    if (reconciled.products.length > 0) {
      markExplicitEmptyCatalog(false);
    }

    setDb(reconciled);
    if (pullRes.cloudBackups) {
      setCloudBackups(pullRes.cloudBackups);
      setCloudBackupsLoading(false);
    }

    lastCloudPullRecordRef.current = Date.now();
    const recorded = markCloudSyncCompleted('cloud_pull', {
      productCount: reconciled.products.length,
      invoiceCount: reconciled.invoices.length,
      shortageCount: reconciled.shortages.length,
    });

    return {
      outcome: 'synced',
      syncedAt: recorded.lastSyncAt,
      productCount: reconciled.products.length,
      invoiceCount: reconciled.invoices.length,
      shortageCount: reconciled.shortages.length,
    };
  };

  // 2b. Automatic Daily Cloud Backup Scheduler (runs on ANY unlocked active store device)
  // Saves & refreshes today's dated snapshot automatically even from staff/cashier devices;
  // viewing, restoring, downloading, and emailing backups stays strictly restricted to Owner.
  useEffect(() => {
    if (!isAppUnlocked || !authReady || !syncStatus.isOnline) {
      return;
    }

    const todayKey = getDailyBackupDateKey();
    const todayId = buildDailyBackupId(todayKey);
    const adminDaily = cloudBackups.find((b) => b.id === todayId) || null;
    if (adminDaily) {
      setTodayDailyBackup(adminDaily);
    }

    // For non-owner devices, check today's daily manifest once per day before writing
    if (!isCloudAdmin && dailyManifestCheckedDate !== todayKey) {
      let active = true;
      cloudGetDailyBackupManifest(todayKey)
        .then((manifest) => {
          if (!active) return;
          if (manifest) setTodayDailyBackup(manifest);
          setDailyManifestCheckedDate(todayKey);
        })
        .catch(() => {
          if (active) setDailyManifestCheckedDate(todayKey);
        });
      return () => {
        active = false;
      };
    }

    if (isCloudAdmin && cloudBackupsLoading) {
      return;
    }

    if (autoDailyBackupTimerRef.current) {
      clearTimeout(autoDailyBackupTimerRef.current);
      autoDailyBackupTimerRef.current = null;
    }

    const existingDaily =
      adminDaily ||
      (todayDailyBackup && todayDailyBackup.dateKey === todayKey ? todayDailyBackup : null);

    const shouldRun = shouldTriggerAutoDailyBackup({
      isUnlocked: isAppUnlocked,
      isOwner: isOwner && isCloudAdmin,
      isAuthorizedCloud: cloudAuthStatus === 'authorized',
      isOnline: syncStatus.isOnline,
      hasRealData: hasRealLocalOrCloudDataRef.current,
      productCount: db.products.length,
      invoiceCount: db.invoices.length,
      shortageCount: db.shortages.length,
      existingDailyBackup: existingDaily,
    });

    if (!shouldRun) return;

    autoDailyBackupTimerRef.current = setTimeout(() => {
      autoDailyBackupTimerRef.current = null;
      cloudSaveBackupSnapshot(dbRef.current, { reason: 'auto_daily' })
        .then((saved) => {
          setTodayDailyBackup(saved);
          setDailyManifestCheckedDate(saved.dateKey);
        })
        .catch((err) => {
          console.warn('Auto daily cloud backup deferred:', err);
        });
    }, 6000);

    return () => {
      if (autoDailyBackupTimerRef.current) {
        clearTimeout(autoDailyBackupTimerRef.current);
        autoDailyBackupTimerRef.current = null;
      }
    };
  }, [
    isAppUnlocked,
    authReady,
    isOwner,
    isCloudAdmin,
    cloudAuthStatus,
    syncStatus.isOnline,
    db.products,
    db.invoices,
    db.shortages,
    cloudBackups,
    cloudBackupsLoading,
    todayDailyBackup,
    dailyManifestCheckedDate,
  ]);

  // 6. Mobile hardware & browser Back Button navigation and double-back to exit
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Seed baseline history states
    window.history.replaceState({ tab: 'home' }, '', '#home');
    window.history.pushState({ tab: 'home' }, '', '#home');

    const handlePopState = () => {
      // 1. If an invoice preview modal is open, close it first and stay on the current tab
      if (selectedInvoiceRef.current) {
        setSelectedInvoice(null);
        window.history.pushState({ tab: activeTabRef.current }, '', '#' + activeTabRef.current);
        return;
      }

      // 2. If the owner login modal is open, close it first
      if (isOwnerModalOpenRef.current) {
        setIsOwnerModalOpen(false);
        window.history.pushState({ tab: activeTabRef.current }, '', '#' + activeTabRef.current);
        return;
      }

      const currentTab = activeTabRef.current;

      // 3. If currently inside any submenu/tab (POS, Shortages, Products, Settings, etc.), return to Home!
      if (currentTab !== 'home') {
        setActiveTab('home');
        window.history.replaceState({ tab: 'home' }, '', '#home');
        window.history.pushState({ tab: 'home' }, '', '#home');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      // 4. Currently on 'home' -> Double-back to exit logic
      const now = Date.now();
      if (now - lastBackPressTimeRef.current < 2000) {
        // Second press within 2 seconds: Allow exit
        window.history.back();
      } else {
        // First press on home: intercept, push state back, show prompt
        lastBackPressTimeRef.current = now;
        window.history.pushState({ tab: 'home' }, '', '#home');
        soundFx.playWarning();
        setExitToastMessage('اضغط زر الرجوع مرة أخرى للخروج من البرنامج');
        if (exitToastTimerRef.current) clearTimeout(exitToastTimerRef.current);
        exitToastTimerRef.current = setTimeout(() => {
          setExitToastMessage(null);
        }, 2200);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (exitToastTimerRef.current) clearTimeout(exitToastTimerRef.current);
    };
  }, []);

  // Fast per-slice localStorage & IndexedDB persistence (never overwrites real IndexedDB data with 355-item seed fallback)
  const prevDbRef = useRef<AppDatabase>(db);
  useEffect(() => {
    const prev = prevDbRef.current;
    if (!hasRealLocalOrCloudDataRef.current && !hasUserMutatedRef.current) {
      prevDbRef.current = db;
      return;
    }
    if (prev.products !== db.products) saveStoredSlice('products', db.products);
    if (prev.invoices !== db.invoices) saveStoredSlice('invoices', db.invoices);
    if (prev.shortages !== db.shortages) saveStoredSlice('shortages', db.shortages);
    if (prev.settings !== db.settings) saveStoredSlice('settings', db.settings);
    if (prev.trash !== db.trash) saveStoredSlice('trash', db.trash || []);
    prevDbRef.current = db;
  }, [db]);

  // Add product to cart helper
  const handleAddToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [
        ...prev,
        {
          id: product.id,
          productId: product.id,
          name: product.name,
          price: product.price,
          originalPrice: product.price,
          quantity: 1,
          category: product.category,
          unit: 'piece',
        },
      ];
    });
  };

  // Add product to shortages queue helper
  const handleAddToShortage = (product: Product): { added: boolean; message: string } => {
    const existing = dbRef.current.shortages.find(
      (s) => normalizeArabicText(s.name) === normalizeArabicText(product.name)
    );

    if (existing) {
      return {
        added: false,
        message: 'هذا الصنف مضاف بالفعل إلى قائمة النواقص!',
      };
    }

    const newShortage: ShortageItem = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: product.name,
      quantity: 1,
      category: product.category || 'بدون مجموعة',
      done: false,
      date: new Date().toISOString(),
    };

    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    setDb((prev) => ({
      ...prev,
      shortages: [newShortage, ...prev.shortages],
    }));

    // Save offline-first and sync immediately when online
    enqueueSyncOp({
      key: `shortages:${newShortage.id}`,
      type: 'saveShortage',
      payload: newShortage,
    });

    return {
      added: true,
      message: `تمت إضافة «${product.name}» إلى قائمة النواقص وحفظها بنجاح`,
    };
  };

  // Save / Update Invoice (Collaborative: works offline and auto-syncs when online)
  const handleSaveInvoice = (invoice: Invoice) => {
    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    setDb((prev) => {
      const existingIdx = prev.invoices.findIndex((inv) => inv.id === invoice.id);
      const updatedInvoices =
        existingIdx >= 0
          ? prev.invoices.map((inv) => (inv.id === invoice.id ? invoice : inv))
          : [invoice, ...prev.invoices];
      return {
        ...prev,
        invoices: updatedInvoices,
      };
    });

    enqueueSyncOp({
      key: `invoices:${invoice.id}`,
      type: 'saveInvoice',
      payload: invoice,
    });
  };

  // Delete Invoice -> moves to 30-day Trash Bin (Protected: Store Owner Only)
  const handleDeleteInvoice = (invoiceId: string) => {
    if (!isOwner) {
      soundFx.playWarning();
      setIsOwnerModalOpen(true);
      return;
    }

    const target = dbRef.current.invoices.find((inv) => inv.id === invoiceId);
    const trashEntry = target
      ? createTrashItem('invoice', target, new Date(), firebaseUser?.email || 'owner')
      : null;

    soundFx.playRemove();
    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    setDb((prev) => ({
      ...prev,
      invoices: prev.invoices.filter((inv) => inv.id !== invoiceId),
      trash: trashEntry
        ? filterActiveTrashItems([trashEntry, ...(prev.trash || [])])
        : prev.trash,
    }));

    enqueueSyncOp({
      key: `invoices:${invoiceId}`,
      type: 'deleteInvoice',
      id: invoiceId,
    });
    if (trashEntry) {
      enqueueSyncOp({
        key: `trash:${trashEntry.id}`,
        type: 'saveTrashItem',
        payload: trashEntry,
      });
    }
  };

  // Save / Update Product
  // Rule: Anyone can add a NEW unlisted product. BUT only the Owner can EDIT existing products or prices.
  const handleSaveProduct = (product: Product) => {
    const exists = dbRef.current.products.some((p) => p.id === product.id);
    if (exists && !isOwner) {
      soundFx.playWarning();
      setIsOwnerModalOpen(true);
      return;
    }

    markExplicitEmptyCatalog(false);
    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    setDb((prev) => {
      const updatedProducts = exists
        ? prev.products.map((p) => (p.id === product.id ? product : p))
        : [product, ...prev.products];
      return {
        ...prev,
        products: updatedProducts,
      };
    });

    enqueueSyncOp({
      key: `products:${product.id}`,
      type: 'saveProduct',
      payload: product,
    });
  };

  // Delete Product -> moves to 30-day Trash Bin (Protected: Store Owner Only)
  const handleDeleteProduct = (productId: string) => {
    if (!isOwner) {
      soundFx.playWarning();
      setIsOwnerModalOpen(true);
      return;
    }

    const target = dbRef.current.products.find((p) => p.id === productId);
    const trashEntry = target
      ? createTrashItem('product', target, new Date(), firebaseUser?.email || 'owner')
      : null;

    soundFx.playRemove();
    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    setDb((prev) => ({
      ...prev,
      products: prev.products.filter((p) => p.id !== productId),
      trash: trashEntry
        ? filterActiveTrashItems([trashEntry, ...(prev.trash || [])])
        : prev.trash,
    }));

    enqueueSyncOp({
      key: `products:${productId}`,
      type: 'deleteProduct',
      id: productId,
    });
    if (trashEntry) {
      enqueueSyncOp({
        key: `trash:${trashEntry.id}`,
        type: 'saveTrashItem',
        payload: trashEntry,
      });
    }
  };

  // Rename Category (Protected: Store Owner Only)
  const handleRenameCategory = (oldName: string, newName: string) => {
    if (!isOwner) {
      soundFx.playWarning();
      setIsOwnerModalOpen(true);
      return;
    }

    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    const updatedProducts = dbRef.current.products.map((p) =>
      (p.category || 'بدون مجموعة').trim() === oldName ? { ...p, category: newName } : p
    );
    setDb((prev) => ({
      ...prev,
      products: updatedProducts,
    }));

    const affected = updatedProducts.filter((p) => p.category === newName);
    for (const p of affected) {
      enqueueSyncOp({
        key: `products:${p.id}`,
        type: 'saveProduct',
        payload: p,
      });
    }
  };

  // Delete Category (Protected: Store Owner Only)
  const handleDeleteCategory = (categoryName: string) => {
    if (!isOwner) {
      soundFx.playWarning();
      setIsOwnerModalOpen(true);
      return;
    }

    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    const updatedProducts = dbRef.current.products.map((p) =>
      (p.category || 'بدون مجموعة').trim() === categoryName ? { ...p, category: 'بدون مجموعة' } : p
    );
    setDb((prev) => ({
      ...prev,
      products: updatedProducts,
    }));

    const affected = updatedProducts.filter((p) => p.category === 'بدون مجموعة');
    for (const p of affected) {
      enqueueSyncOp({
        key: `products:${p.id}`,
        type: 'saveProduct',
        payload: p,
      });
    }
  };

  // Save Batch Shortages (computes updated items outside setDb updater for React 19 safety)
  const handleSaveShortages = (items: { name: string; quantity: number; category?: string; notes?: string }[]) => {
    const now = new Date().toISOString();
    const current = dbRef.current;
    const updatedShortages = [...current.shortages];
    const itemsToSync: ShortageItem[] = [];

    items.forEach((item) => {
      const existingIdx = updatedShortages.findIndex(
        (s) => normalizeArabicText(s.name) === normalizeArabicText(item.name)
      );

      let shortageItem: ShortageItem;
      if (existingIdx >= 0) {
        shortageItem = {
          ...updatedShortages[existingIdx],
          quantity: item.quantity,
          category: item.category || updatedShortages[existingIdx].category,
          notes: item.notes !== undefined ? (item.notes.trim() || undefined) : updatedShortages[existingIdx].notes,
          updatedAt: now,
        };
        updatedShortages[existingIdx] = shortageItem;
      } else {
        const matchedProduct = current.products.find(
          (p) => normalizeArabicText(p.name) === normalizeArabicText(item.name)
        );
        shortageItem = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: item.name,
          quantity: item.quantity,
          category: item.category || (matchedProduct ? matchedProduct.category : 'بدون مجموعة'),
          notes: item.notes?.trim() || undefined,
          done: false,
          date: now,
        };
        updatedShortages.unshift(shortageItem);
      }

      itemsToSync.push(shortageItem);
    });

    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    setDb((prev) => ({
      ...prev,
      shortages: updatedShortages,
    }));

    for (const shortageItem of itemsToSync) {
      enqueueSyncOp({
        key: `shortages:${shortageItem.id}`,
        type: 'saveShortage',
        payload: shortageItem,
      });
    }
  };

  // Toggle Shortage status
  const handleToggleShortageStatus = (id: string) => {
    const existing = dbRef.current.shortages.find((s) => s.id === id);
    if (!existing) return;

    const changed: ShortageItem = {
      ...existing,
      done: !existing.done,
      updatedAt: new Date().toISOString(),
    };

    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    setDb((prev) => ({
      ...prev,
      shortages: prev.shortages.map((s) => (s.id === id ? changed : s)),
    }));

    enqueueSyncOp({
      key: `shortages:${changed.id}`,
      type: 'saveShortage',
      payload: changed,
    });
  };

  // Update Shortage Quantity (instant UI + debounced cloud/outbox sync so rapid taps stay fast)
  const handleUpdateShortageQuantity = (id: string, quantity: number) => {
    const existing = dbRef.current.shortages.find((s) => s.id === id);
    if (!existing) return;

    const safeQty = Math.max(1, Math.min(10000, Math.round(Number(quantity) || 1)));
    const changed: ShortageItem = {
      ...existing,
      quantity: safeQty,
      updatedAt: new Date().toISOString(),
    };

    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    setDb((prev) => ({
      ...prev,
      shortages: prev.shortages.map((s) => (s.id === id ? changed : s)),
    }));

    if (qtySyncTimersRef.current[id]) {
      clearTimeout(qtySyncTimersRef.current[id]);
    }
    qtySyncTimersRef.current[id] = setTimeout(() => {
      delete qtySyncTimersRef.current[id];
      enqueueSyncOp({
        key: `shortages:${changed.id}`,
        type: 'saveShortage',
        payload: changed,
      });
    }, 220);
  };

  // Update Shortage Notes (collaborative: allows cashier and owner to add/edit notes)
  const handleUpdateShortageNotes = (id: string, notes: string) => {
    const existing = dbRef.current.shortages.find((s) => s.id === id);
    if (!existing) return;

    const changed: ShortageItem = {
      ...existing,
      notes: notes.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };

    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    setDb((prev) => ({
      ...prev,
      shortages: prev.shortages.map((s) => (s.id === id ? changed : s)),
    }));

    enqueueSyncOp({
      key: `shortages:${changed.id}`,
      type: 'saveShortage',
      payload: changed,
    });
  };

  // Delete single shortage -> moves to 30-day Trash Bin (Protected: Store Owner Only)
  const handleDeleteShortage = (id: string) => {
    if (!isOwner) {
      soundFx.playWarning();
      setIsOwnerModalOpen(true);
      return;
    }

    if (qtySyncTimersRef.current[id]) {
      clearTimeout(qtySyncTimersRef.current[id]);
      delete qtySyncTimersRef.current[id];
    }

    const target = dbRef.current.shortages.find((s) => s.id === id);
    const trashEntry = target
      ? createTrashItem('shortage', target, new Date(), firebaseUser?.email || 'owner')
      : null;

    soundFx.playRemove();
    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    setDb((prev) => ({
      ...prev,
      shortages: prev.shortages.filter((s) => s.id !== id),
      trash: trashEntry
        ? filterActiveTrashItems([trashEntry, ...(prev.trash || [])])
        : prev.trash,
    }));

    enqueueSyncOp({
      key: `shortages:${id}`,
      type: 'deleteShortage',
      id,
    });
    if (trashEntry) {
      enqueueSyncOp({
        key: `trash:${trashEntry.id}`,
        type: 'saveTrashItem',
        payload: trashEntry,
      });
    }
  };

  // Delete all shortages -> moves all to 30-day Trash Bin (Protected: Store Owner Only)
  const handleDeleteAllShortages = async () => {
    if (!isOwner) {
      soundFx.playWarning();
      setIsOwnerModalOpen(true);
      return;
    }

    soundFx.playRemove();
    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    const allShortages = dbRef.current.shortages;
    const allIds = allShortages.map((s) => s.id);
    const nowDate = new Date();
    const trashEntries = allShortages.map((s) =>
      createTrashItem('shortage', s, nowDate, firebaseUser?.email || 'owner')
    );

    // Clear local state immediately for instant feedback
    setDb((prev) => ({
      ...prev,
      shortages: [],
      trash: filterActiveTrashItems([...trashEntries, ...(prev.trash || [])]),
    }));

    if (trashEntries.length > 0) {
      enqueueSyncOp({
        key: `trash:batch_shortages_${Date.now()}`,
        type: 'batchSaveTrashItems',
        payload: trashEntries,
      });
    }

    // Queue & execute batch delete (survives offline and syncs automatically on reconnect)
    if (allIds.length > 0) {
      enqueueBatchDeleteShortages(allIds);
    }
  };

  // Update Store Settings (Protected: Store Owner Only)
  const handleUpdateSettings = (settings: StoreSettings) => {
    if (!isOwner) {
      soundFx.playWarning();
      setIsOwnerModalOpen(true);
      return;
    }

    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    const mergedSettings = {
      ...dbRef.current.settings,
      ...settings,
    };
    setDb((prev) => ({
      ...prev,
      settings: mergedSettings,
    }));
    enqueueSyncOp({
      key: 'settings:main',
      type: 'saveSettings',
      payload: mergedSettings,
    });
  };

  // Restore Database from JSON, Google Drive, or Cloud Snapshot (Protected: Store Owner Only)
  const handleRestoreDatabase = async (newDb: AppDatabase) => {
    if (!isOwner) {
      soundFx.playWarning();
      setIsOwnerModalOpen(true);
      return;
    }

    soundFx.playSuccess();
    markExplicitEmptyCatalog((newDb.products || []).length === 0);
    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;

    const mergedRestore: AppDatabase = {
      ...newDb,
      trash: newDb.trash || dbRef.current.trash || [],
    };
    // Immediately flush to IndexedDB + localStorage before queueing cloud upload
    saveStoredData(mergedRestore);
    setDb(mergedRestore);
    setCart([]);
    setSelectedInvoice(null);

    if (mergedRestore.products && mergedRestore.products.length > 0) {
      enqueueSyncOp({
        key: 'batch:products',
        type: 'batchSeedProducts',
        payload: mergedRestore.products,
      });
    }

    if (mergedRestore.shortages && Array.isArray(mergedRestore.shortages)) {
      enqueueSyncOp({
        key: 'batch:shortages',
        type: 'batchSeedShortages',
        payload: mergedRestore.shortages,
        wipeExisting: true,
      });
    }

    if (mergedRestore.invoices && mergedRestore.invoices.length > 0) {
      enqueueSyncOp({
        key: 'batch:invoices',
        type: 'batchSeedInvoices',
        payload: mergedRestore.invoices,
      });
    }

    if (mergedRestore.settings && mergedRestore.settings.shop) {
      enqueueSyncOp({
        key: 'settings:main',
        type: 'saveSettings',
        payload: mergedRestore.settings,
      });
    }
  };

  // Restore Single Item from 30-Day Trash Bin (Owner Only)
  const handleRestoreTrashItem = (trashItem: TrashItem) => {
    if (!isOwner) {
      soundFx.playWarning();
      setIsOwnerModalOpen(true);
      return;
    }

    soundFx.playSuccess();
    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    const restoredDb = restoreItemFromTrash(dbRef.current, trashItem);
    if (trashItem.entityType === 'product') {
      markExplicitEmptyCatalog(false);
    }
    setDb(restoredDb);
    saveStoredData(restoredDb);

    if (trashItem.entityType === 'product') {
      const p = restoredDb.products.find((item) => item.id === (trashItem.data as Product).id || item.id === trashItem.originalId);
      if (p) {
        enqueueSyncOp({ key: `products:${p.id}`, type: 'saveProduct', payload: p });
      }
    } else if (trashItem.entityType === 'invoice') {
      const inv = restoredDb.invoices.find((item) => item.id === (trashItem.data as Invoice).id || item.id === trashItem.originalId);
      if (inv) {
        enqueueSyncOp({ key: `invoices:${inv.id}`, type: 'saveInvoice', payload: inv });
      }
    } else {
      const sh = restoredDb.shortages.find((item) => item.id === (trashItem.data as ShortageItem).id || item.id === trashItem.originalId);
      if (sh) {
        enqueueSyncOp({ key: `shortages:${sh.id}`, type: 'saveShortage', payload: sh });
      }
    }

    enqueueSyncOp({
      key: `trash:${trashItem.id}`,
      type: 'deleteTrashItem',
      id: trashItem.id,
    });
  };

  // Permanently Delete One Item from Trash Bin
  const handlePermanentDeleteTrashItem = (trashId: string) => {
    if (!isOwner) {
      soundFx.playWarning();
      setIsOwnerModalOpen(true);
      return;
    }
    soundFx.playRemove();
    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    setDb((prev) => ({
      ...prev,
      trash: (prev.trash || []).filter((t) => t.id !== trashId),
    }));
    enqueueSyncOp({
      key: `trash:${trashId}`,
      type: 'deleteTrashItem',
      id: trashId,
    });
  };

  // Empty Entire Trash Bin Permanently
  const handleEmptyTrash = () => {
    if (!isOwner) {
      soundFx.playWarning();
      setIsOwnerModalOpen(true);
      return;
    }
    const allIds = (dbRef.current.trash || []).map((t) => t.id);
    if (allIds.length === 0) return;
    soundFx.playRemove();
    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;
    setDb((prev) => ({
      ...prev,
      trash: [],
    }));
    enqueueSyncOp({
      key: `trash:empty:${Date.now()}`,
      type: 'batchDeleteTrashItems',
      ids: allIds,
    });
  };

  // Cloud Backups Vault Actions (Owner Only)
  const handleCreateManualCloudBackup = async (): Promise<CloudBackupManifest> => {
    if (!isOwner) {
      setIsOwnerModalOpen(true);
      throw new Error('يتطلب وضع المالك لأخذ نسخة سحابية');
    }
    if (cloudAuthStatus !== 'authorized' || !isCloudAdmin) {
      throw new Error('يرجى ربط حساب Google الخاص بالمالك أولاً لحفظ النسخة على السحابة');
    }
    return await cloudSaveBackupSnapshot(dbRef.current, { reason: 'manual' });
  };

  const handleRestoreCloudBackup = async (manifest: CloudBackupManifest): Promise<AppDatabase> => {
    if (!isOwner) {
      setIsOwnerModalOpen(true);
      throw new Error('يتطلب وضع المالك للاستعادة');
    }
    if (cloudAuthStatus !== 'authorized' || !isCloudAdmin) {
      throw new Error('يرجى ربط حساب Google الخاص بالمالك أولاً');
    }
    // Best-effort safety snapshot before restoring historical date
    if (dbRef.current.products.length > 0 && navigator.onLine) {
      try {
        await cloudSaveBackupSnapshot(dbRef.current, { reason: 'pre_restore' });
      } catch {
        // Non-blocking
      }
    }
    const restored = await cloudLoadBackupSnapshot(manifest, dbRef.current.settings);
    // Wipe remote stale items if restoring an older smaller catalog, then seed snapshot
    if (navigator.onLine) {
      enqueueSyncOp({ key: 'wipe:store', type: 'wipeStoreData' });
    }
    await handleRestoreDatabase(restored);
    return restored;
  };

  const handleDownloadCloudBackupJson = async (manifest: CloudBackupManifest): Promise<void> => {
    if (!isOwner) {
      setIsOwnerModalOpen(true);
      return;
    }
    const snapshotDb = await cloudLoadBackupSnapshot(manifest, dbRef.current.settings);
    exportDataAsJsonFile(snapshotDb, true);
  };

  const handleDeleteCloudBackup = async (backupId: string): Promise<void> => {
    if (!isOwner) {
      setIsOwnerModalOpen(true);
      return;
    }
    await cloudDeleteBackupSnapshot(backupId);
  };

  // Send Daily Store JSON Backup to Owner Gmail (runs strictly after explicit ConfirmModal approval)
  const handleSendDailyGmailBackup = async (): Promise<void> => {
    if (!isOwner) {
      soundFx.playWarning();
      setIsOwnerModalOpen(true);
      return;
    }
    if (!navigator.onLine) {
      soundFx.playWarning();
      setGmailBackupFeedback({
        ok: false,
        text: 'أنت بدون إنترنت حالياً — يرجى الاتصال بالإنترنت لإرسال النسخة عبر Gmail.',
      });
      return;
    }

    setGmailBackupBusy(true);
    setGmailBackupFeedback(null);
    try {
      let token = await getAccessToken();
      let signedEmail = (getCachedUserEmail() || firebaseUser?.email || '').trim().toLowerCase();

      if (!token || signedEmail !== OWNER_EMAIL.toLowerCase()) {
        const signInRes = await googleSignIn();
        token = signInRes?.accessToken || null;
        signedEmail = (signInRes?.user?.email || '').trim().toLowerCase();
      }

      if (signedEmail && signedEmail !== OWNER_EMAIL.toLowerCase()) {
        throw new Error(`يجب تسجيل الدخول ببريد المالك (${OWNER_EMAIL}) لإرسال النسخة اليومية.`);
      }

      if (!token) {
        throw new Error('تعذر الحصول على تصريح Gmail — يرجى المحاولة مرة أخرى.');
      }

      let result;
      try {
        result = await sendDailyBackupViaGmail({
          dbState: dbRef.current,
          accessToken: token,
          recipientEmail: OWNER_EMAIL,
        });
      } catch (err: unknown) {
        if ((err as Error)?.message === 'AUTH_TOKEN_EXPIRED_OR_MISSING_SCOPE') {
          const refreshed = await googleSignIn();
          if (!refreshed?.accessToken) {
            throw new Error('تعذر تجديد تصريح Gmail — يرجى المحاولة مرة أخرى.');
          }
          result = await sendDailyBackupViaGmail({
            dbState: dbRef.current,
            accessToken: refreshed.accessToken,
            recipientEmail: OWNER_EMAIL,
          });
        } else {
          throw err;
        }
      }

      setGmailBackupMeta(readGmailDailyBackupMeta());
      setDismissedDailyGmailBanner(true);
      setIsGmailDailyPromptModalOpen(false);
      soundFx.playSuccess();
      setGmailBackupFeedback({
        ok: true,
        text: `✅ تم إرسال نسخة اليوم (${result.dateKey}) بنجاح إلى بريد المالك (${result.recipient}) — ${result.productCount} صنف · ${result.invoiceCount} فاتورة.`,
      });
    } catch (err: unknown) {
      soundFx.playWarning();
      setGmailBackupFeedback({
        ok: false,
        text: (err as Error)?.message || 'تعذر إرسال النسخة إلى Gmail حالياً.',
      });
    } finally {
      setGmailBackupBusy(false);
    }
  };

  // Complete Store Wipe (Protected: Store Owner Only)
  // Wipes ALL products, ALL retail/wholesale/dozen prices, ALL categories, shortages, and invoices
  // while archiving deleted items into the 30-day Trash Bin & saving a pre-wipe cloud backup first.
  const handleWipeDatabase = async () => {
    if (!isOwner) {
      soundFx.playWarning();
      setIsOwnerModalOpen(true);
      return;
    }

    const current = dbRef.current;
    // 1. Save automatic pre-wipe safety snapshot to Cloud Vault if Owner Google Auth is active
    if (isCloudAdmin && cloudAuthStatus === 'authorized' && navigator.onLine && current.products.length > 0) {
      try {
        await cloudSaveBackupSnapshot(current, { reason: 'pre_wipe' });
      } catch {
        // Proceed with wipe even if snapshot failed
      }
    }

    // 2. Move wiped products, invoices, and shortages into the 30-day Trash Bin
    const nowDate = new Date();
    const actor = firebaseUser?.email || 'owner';
    const wipedTrashItems: TrashItem[] = [
      ...(current.products || []).map((p) => createTrashItem('product', p, nowDate, actor)),
      ...(current.invoices || []).map((inv) => createTrashItem('invoice', inv, nowDate, actor)),
      ...(current.shortages || []).map((s) => createTrashItem('shortage', s, nowDate, actor)),
    ];

    soundFx.playRemove();
    markExplicitEmptyCatalog(true);
    hasUserMutatedRef.current = true;
    hasRealLocalOrCloudDataRef.current = true;

    const nextTrash = filterActiveTrashItems([...wipedTrashItems, ...(current.trash || [])]);
    const emptyDb: AppDatabase = {
      products: [],
      invoices: [],
      shortages: [],
      trash: nextTrash,
      settings: current.settings.shop
        ? current.settings
        : {
            shop: 'مكتبة الطيب أحسن',
            phone: '01151906520',
            tagline: '',
            address: '',
          },
    };

    saveStoredData(emptyDb);
    setDb(emptyDb);
    setCart([]);
    setSelectedInvoice(null);

    enqueueSyncOp({
      key: 'wipe:store',
      type: 'wipeStoreData',
    });

    if (wipedTrashItems.length > 0) {
      enqueueSyncOp({
        key: 'wipe:trash_save',
        type: 'batchSaveTrashItems',
        payload: wipedTrashItems,
      });
    }
  };

  const activeShortagesCount = db.shortages.length;
  const cartTotalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const showDailyGmailBanner =
    !dismissedDailyGmailBanner &&
    shouldPromptDailyGmailBackup({
      isOwner: isOwner && isCloudAdmin,
      isCloudAdmin,
      isOnline: syncStatus.isOnline,
      hasRealData: hasRealLocalOrCloudDataRef.current,
      productCount: db.products.length,
      ownerEmail: OWNER_EMAIL,
      signedInEmail: firebaseUser?.email || getCachedUserEmail(),
      todayKey: getDailyBackupDateKey(),
      lastSentDateKey: gmailBackupMeta.lastSentDateKey,
    });

  // If the app is locked, render the Master Security Gate
  if (!isAppUnlocked) {
    return (
      <SecurityGate
        onUnlock={handleUnlockApp}
        shopName={db.settings.shop}
        shopPhone={db.settings.phone}
      />
    );
  }

  // Startup Auto-Update & Cloud Sync Splash Screen (shown once on app launch)
  if (showStartupSplash) {
    return (
      <StartupSyncSplash
        shopName={db.settings.shop}
        shopTagline={db.settings.tagline}
        initialProductCount={db.products.length}
        onRunStartupSync={runFullCloudRefresh}
        onComplete={() => setShowStartupSplash(false)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-100/60 flex flex-col font-sans">
      {/* Header with Owner/Staff Role Switcher, Cloud Status, and Lock App */}
      <Header
        activeTab={activeTab}
        setActiveTab={handleNavigate}
        settings={db.settings}
        cartCount={cartTotalItems}
        shortagesCount={activeShortagesCount}
        isOwner={isOwner}
        onOpenOwnerModal={() => setIsOwnerModalOpen(true)}
        isCloudSynced={isCloudSynced}
        onLockApp={handleLockApp}
      />

      {/* PWA Offline & Install Banner */}
      <PWAInstallBanner />

      {/* Contextual Cloud / Owner Google Account / Daily Gmail Backup Banner */}
      {authReady && (cloudAuthStatus === 'unauthorized' || cloudAuthStatus === 'unverified') && (
        <div className="no-print max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-4">
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-right shadow-2xs">
            <div className="text-xs text-rose-900 leading-relaxed">
              <strong className="block font-black text-rose-950 mb-0.5">
                ⛔ الحساب الحالي ({firebaseUser?.email || 'غير موثق'}) لا يملك صلاحية المالك
              </strong>
              <span>
                المزامنة العامة للأصناف الجديدة والفواتير والنواقص تعمل، لكن إدارة الحذف والنسخ الاحتياطية مقتصرة على بريد المالك ({OWNER_EMAIL}).
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  soundFx.playClick();
                  await signOutOwner();
                }}
                className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl cursor-pointer transition-colors"
              >
                تسجيل خروج وتبديل الحساب
              </button>
            </div>
          </div>
        </div>
      )}

      {authReady && isOwner && cloudAuthStatus !== 'authorized' && cloudAuthStatus !== 'checking' && cloudAuthStatus !== 'unauthorized' && cloudAuthStatus !== 'unverified' && (
        <div className="no-print max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-4">
          <div className="bg-gradient-to-l from-sky-900 via-slate-900 to-teal-950 text-white rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm border border-sky-700/40">
            <div className="text-xs leading-relaxed">
              <strong className="block font-black text-sky-300 mb-0.5">
                👑 ربط حساب المالك لإرسال النسخة اليومية وتفعيل الحذف والتعديل
              </strong>
              <span className="text-slate-300">
                سجّل الدخول بحساب Google للمالك ({OWNER_EMAIL}) على هذا الجهاز لتفعيل الحفظ السحابي اليومي والنسخ لبريد Gmail.
              </span>
              {cloudBannerError && (
                <span className="block text-amber-300 font-bold mt-1">{cloudBannerError}</span>
              )}
            </div>
            <button
              type="button"
              disabled={cloudBannerBusy}
              onClick={async () => {
                soundFx.playClick();
                setCloudBannerBusy(true);
                setCloudBannerError(null);
                const res = await signInWithGoogleForCloud();
                setCloudBannerBusy(false);
                if (!res.success && res.error) {
                  setCloudBannerError(res.error);
                }
              }}
              className="bg-white hover:bg-slate-100 text-slate-900 font-black text-xs px-4 py-2.5 rounded-xl shadow flex items-center justify-center gap-2 shrink-0 cursor-pointer disabled:opacity-60"
            >
              <span>{cloudBannerBusy ? 'جارٍ الربط...' : 'ربط جيميل المالك'}</span>
            </button>
          </div>
        </div>
      )}

      {authReady && showDailyGmailBanner && (
        <div className="no-print max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
            <div className="text-xs text-emerald-950 leading-relaxed">
              <strong className="block font-black text-emerald-900 mb-0.5">
                📧 نسخة اليوم الاحتياطية جاهزة للإرسال إلى جيميل المالك ({getDailyBackupDateKey()})
              </strong>
              <span className="text-emerald-800">
                أنت مسجل حالياً بجيميل المالك — يمكنك إرسال نسخة المتجر اليومية الآن إلى بريدك ({OWNER_EMAIL}) للاحتفاظ بها بأمان.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  soundFx.playClick();
                  setIsGmailDailyPromptModalOpen(true);
                }}
                className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-2xs cursor-pointer"
              >
                إرسال نسخة اليوم الآن
              </button>
              <button
                type="button"
                onClick={() => setDismissedDailyGmailBanner(true)}
                className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-bold text-xs px-3 py-2 rounded-xl cursor-pointer"
              >
                لاحقاً
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'home' && (
          <Dashboard
            db={db}
            onNavigate={handleNavigate}
            onAddToCart={handleAddToCart}
            onAddToShortage={handleAddToShortage}
            onOpenInvoiceModal={setSelectedInvoice}
            isOwner={isOwner}
            onOpenOwnerModal={() => setIsOwnerModalOpen(true)}
            syncStatus={syncStatus}
            cloudAuthStatus={cloudAuthStatus}
            onManualRefresh={runFullCloudRefresh}
          />
        )}

        {activeTab === 'price-check' && (
          <PriceCheckView
            db={db}
            onNavigate={handleNavigate}
            onAddToCart={handleAddToCart}
            onAddToShortage={handleAddToShortage}
          />
        )}

        {activeTab === 'pos' && (
          <POSView
            db={db}
            cart={cart}
            setCart={setCart}
            onSaveInvoice={handleSaveInvoice}
            onDeleteInvoice={handleDeleteInvoice}
            selectedInvoice={selectedInvoice}
            setSelectedInvoice={setSelectedInvoice}
            isOwner={isOwner}
            onRequestOwnerLogin={() => setIsOwnerModalOpen(true)}
            onAddProduct={handleSaveProduct}
          />
        )}

        {activeTab === 'products' && (
          <ProductsView
            db={db}
            onSaveProduct={handleSaveProduct}
            onDeleteProduct={handleDeleteProduct}
            onAddToShortage={handleAddToShortage}
            onRenameCategory={handleRenameCategory}
            onDeleteCategory={handleDeleteCategory}
            isOwner={isOwner}
            onRequestOwnerLogin={() => setIsOwnerModalOpen(true)}
          />
        )}

        {activeTab === 'shortages' && (
          <ShortagesView
            db={db}
            onSaveShortages={handleSaveShortages}
            onToggleShortageStatus={handleToggleShortageStatus}
            onUpdateShortageQuantity={handleUpdateShortageQuantity}
            onUpdateShortageNotes={handleUpdateShortageNotes}
            onDeleteShortage={handleDeleteShortage}
            onDeleteAllShortages={handleDeleteAllShortages}
            isOwner={isOwner}
            onOpenOwnerModal={() => setIsOwnerModalOpen(true)}
          />
        )}

        {activeTab === 'drive' && (
          <GoogleDriveView
            db={db}
            onRestoreDatabase={handleRestoreDatabase}
            isOwner={isOwner}
            onRequestOwnerLogin={() => setIsOwnerModalOpen(true)}
          />
        )}

        {activeTab === 'print' && (
          <PrintCatalogView
            db={db}
            isOwner={isOwner}
            onRequestOwnerLogin={() => setIsOwnerModalOpen(true)}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            db={db}
            onUpdateSettings={handleUpdateSettings}
            onRestoreDatabase={handleRestoreDatabase}
            onWipeDatabase={handleWipeDatabase}
            onNavigate={handleNavigate}
            isOwner={isOwner}
            onRequestOwnerLogin={() => setIsOwnerModalOpen(true)}
            onLockApp={handleLockApp}
            firebaseUser={firebaseUser}
            cloudAuthStatus={cloudAuthStatus}
            isCloudAdmin={isCloudAdmin}
            cloudBackups={cloudBackups}
            cloudBackupsLoading={cloudBackupsLoading}
            onCreateManualCloudBackup={handleCreateManualCloudBackup}
            onRestoreCloudBackup={handleRestoreCloudBackup}
            onDownloadCloudBackupJson={handleDownloadCloudBackupJson}
            onDeleteCloudBackup={handleDeleteCloudBackup}
            onRestoreTrashItem={handleRestoreTrashItem}
            onPermanentDeleteTrashItem={handlePermanentDeleteTrashItem}
            onEmptyTrash={handleEmptyTrash}
            syncStatus={syncStatus}
            onManualRefresh={runFullCloudRefresh}
            gmailBackupMeta={gmailBackupMeta}
            gmailBackupBusy={gmailBackupBusy}
            gmailBackupFeedback={gmailBackupFeedback}
            onSendDailyGmailBackup={handleSendDailyGmailBackup}
            todayDailyBackup={
              cloudBackups.find((b) => b.id === buildDailyBackupId(getDailyBackupDateKey())) ||
              todayDailyBackup
            }
          />
        )}
      </main>

      {/* Owner Login & Permissions Modal */}
      <OwnerLoginModal
        isOpen={isOwnerModalOpen}
        onClose={() => setIsOwnerModalOpen(false)}
        isOwner={isOwner}
        onOwnerAuthenticated={() => setIsOwner(true)}
        onOwnerLoggedOut={() => setIsOwner(false)}
      />

      {/* Explicit Confirmation Modal for Daily Gmail Backup from Top Banner */}
      <ConfirmModal
        isOpen={isGmailDailyPromptModalOpen}
        title="إرسال النسخة اليومية لبريد المالك (Gmail)"
        description={`سيتم إرسال نسخة المتجر بتاريخ (${getDailyBackupDateKey()}) كملف JSON مرفق إلى بريد المالك (${OWNER_EMAIL}).`}
        confirmLabel="نعم، إرسال النسخة الآن"
        isDestructive={false}
        isLoading={gmailBackupBusy}
        itemDetails={[
          { label: 'البريد المستلم', value: OWNER_EMAIL },
          { label: 'الأصناف / الفواتير', value: `${db.products.length} صنف · ${db.invoices.length} فاتورة` },
          { label: 'النواقص', value: `${db.shortages.length} صنف` },
        ]}
        onConfirm={handleSendDailyGmailBackup}
        onCancel={() => setIsGmailDailyPromptModalOpen(false)}
      />

      {/* Mobile Double-Back Exit Prompt Toast */}
      {exitToastMessage && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 backdrop-blur-md text-white px-5 py-3 rounded-2xl shadow-2xl border border-slate-700 text-xs sm:text-sm font-bold flex items-center gap-2.5 animate-bounce-subtle pointer-events-none">
          <span className="text-amber-400 text-base">⚠️</span>
          <span>{exitToastMessage}</span>
        </div>
      )}

      {/* Footer (No-Print) */}
      <footer className="no-print bg-white border-t border-slate-200 py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span>جميع الحقوق محفوظة © {new Date().getFullYear()} — </span>
            <strong className="text-slate-800">{db.settings.shop || 'نظام إدارة المبيعات'}</strong>
            <span className="text-slate-400">·</span>
            <span className="text-[11px] text-emerald-600 font-semibold">
              {isOwner ? '👑 وضع المالك نشط' : '👤 وضع الكاشير والموظفين (البيع وعمل الفواتير)'}
            </span>
          </div>
          {db.settings.phone && (
            <div>
              <span>تواصل واتساب مباشر: </span>
              <a
                href={buildWhatsAppUrl(db.settings.phone)}
                className="font-bold text-emerald-600 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {db.settings.phone}
              </a>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
