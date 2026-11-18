import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import { soundFx } from './utils/audioFeedback';
import { setServiceWorkerRegistration, setUpdateSWHandler } from './utils/pwaUpdate';

// Register offline PWA Service Worker so the app loads & works seamlessly offline
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  try {
    const updateSW = registerSW({
      immediate: true,
      onRegisteredSW(_swUrl, registration) {
        setServiceWorkerRegistration(registration);
        if (registration) {
          const triggerCheck = () => {
            if (navigator.onLine) {
              registration.update().catch(() => {});
            }
          };
          setInterval(triggerCheck, 30 * 60 * 1000);
          window.addEventListener('online', triggerCheck);
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
              triggerCheck();
            }
          });
        }
      },
      onRegisterError(err) {
        console.warn('SW registration note:', err);
      },
    });
    setUpdateSWHandler(updateSW);
  } catch {
    // Ignore if unavailable in sandboxed environment
  }
}

// Global audio click feedback for all interactive elements in the application
if (typeof window !== 'undefined') {
  window.addEventListener(
    'click',
    (e) => {
      const target = (e.target as HTMLElement | null)?.closest(
        'button, a, input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], [role="button"], .cursor-pointer'
      );
      if (target) {
        soundFx.playClick();
      }
    },
    { capture: true, passive: true }
  );
}

createRoot(document.getElementById('root')!).render(<App />);
