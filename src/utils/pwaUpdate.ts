export type AppUpdateCheckResult = 'updated' | 'up_to_date' | 'offline' | 'unsupported';

let swRegistration: ServiceWorkerRegistration | null = null;
let swUpdateRunner: ((reloadPage?: boolean) => Promise<void>) | null = null;
let controllerChangeAttached = false;
let reloadScheduled = false;

export function attachAutoReloadOnControllerChange(): void {
  if (
    controllerChangeAttached ||
    typeof window === 'undefined' ||
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return;
  }
  controllerChangeAttached = true;

  // Guard: only reload when a previous controller existed (i.e. an actual upgrade, not first install)
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloadScheduled) return;
    reloadScheduled = true;
    try {
      const lastReloadAt = Number(sessionStorage.getItem('tayeb_sw_reload_at') || '0');
      if (Date.now() - lastReloadAt < 10_000) return;
      sessionStorage.setItem('tayeb_sw_reload_at', String(Date.now()));
    } catch {
      // Ignore storage failures
    }
    window.location.reload();
  });
}

export function setServiceWorkerRegistration(registration: ServiceWorkerRegistration | undefined): void {
  if (registration) {
    swRegistration = registration;
    attachAutoReloadOnControllerChange();
  }
}

export function setUpdateSWHandler(runner: (reloadPage?: boolean) => Promise<void>): void {
  swUpdateRunner = runner;
}

function waitForWorkerInstalled(worker: ServiceWorker, timeoutMs: number): Promise<boolean> {
  if (worker.state === 'installed' || worker.state === 'activated') {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (val: boolean) => {
      if (settled) return;
      settled = true;
      worker.removeEventListener('statechange', onStateChange);
      clearTimeout(timer);
      resolve(val);
    };
    const onStateChange = () => {
      if (worker.state === 'installed' || worker.state === 'activated') {
        finish(true);
      } else if (worker.state === 'redundant') {
        finish(false);
      }
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    worker.addEventListener('statechange', onStateChange);
  });
}

async function activateWaitingWorker(waitingWorker: ServiceWorker): Promise<void> {
  try {
    if (swUpdateRunner) {
      await Promise.race([
        swUpdateRunner(false),
        new Promise<void>((resolve) => setTimeout(resolve, 1200)),
      ]);
    } else {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Triggers a bounded non-blocking check for newly deployed PWA Service Worker updates.
 * Handles both already-waiting and newly-installing service workers so updates reach
 * every installed copy immediately on launch.
 */
export async function checkForAppUpdate(timeoutMs = 2500): Promise<AppUpdateCheckResult> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }
  if (!navigator.onLine) {
    return 'offline';
  }

  attachAutoReloadOnControllerChange();

  try {
    const reg =
      swRegistration ||
      (await Promise.race([
        navigator.serviceWorker.getRegistration(),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1000)),
      ]));

    if (!reg) {
      return 'unsupported';
    }
    swRegistration = reg;

    await Promise.race([
      reg.update(),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);

    if (reg.installing) {
      await waitForWorkerInstalled(reg.installing, Math.max(1200, timeoutMs));
    }

    if (reg.waiting) {
      await activateWaitingWorker(reg.waiting);
      return 'updated';
    }

    return 'up_to_date';
  } catch {
    return 'unsupported';
  }
}
