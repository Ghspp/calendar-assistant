import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted Hebrew font, so the PWA shell keeps working offline in Stage 10.
import '@fontsource/heebo/400.css';
import '@fontsource/heebo/500.css';
import '@fontsource/heebo/700.css';

import { registerSW } from 'virtual:pwa-register';

import './styles/global.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

/**
 * Keep the installed app up to date on its own.
 *
 * A service worker serves the version it cached, and the page keeps running that code
 * until something reloads it. An installed PWA has no address bar, so without this the
 * only way out of a stale build is a manual control — which is a poor thing to rely on
 * and cost real time to discover when an old version was quietly being served.
 *
 * So: check on every launch, and whenever the app is brought back to the foreground.
 * That covers how the app is actually used — opened, glanced at, put away — and adds
 * nothing while it simply sits on screen. A timer running in the background would
 * wake the radio for no benefit.
 */
const updateServiceWorker = registerSW({
  immediate: true,

  onRegisteredSW(_url, registration) {
    if (registration === undefined) return;

    // Switching away and back repeatedly should not mean a request each time.
    const MIN_GAP_MS = 5 * 60 * 1000;
    let lastCheck = Date.now();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastCheck < MIN_GAP_MS) return;

      lastCheck = Date.now();
      void registration.update().catch(() => undefined);
    });
  },

  onNeedRefresh() {
    // autoUpdate normally handles this, but a waiting worker can still appear when the
    // app was open across a deploy. Take it immediately; there is nothing to lose.
    void updateServiceWorker(true);
  },
});

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container #root not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
