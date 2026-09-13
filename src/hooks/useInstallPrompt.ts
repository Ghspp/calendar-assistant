import { useCallback, useEffect, useState } from 'react';

/**
 * Home-screen install, and whether the network is up.
 *
 * Both are browser facts the assistant screen needs to reflect honestly: an installed
 * app that silently fails offline is worse than one that says the calendar is
 * unreachable.
 */

/** Chrome fires this instead of prompting, so the app can choose when to ask. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface UseInstallPromptResult {
  /** True when the browser has offered an install and the user has not acted on it. */
  canInstall: boolean;
  /** True when already running from the home screen. */
  isInstalled: boolean;
  install: () => Promise<void>;
  dismiss: () => void;
}

function detectInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // Chrome reports standalone through the media query; iOS uses a navigator flag.
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    const iosStandalone = (navigator as { standalone?: boolean }).standalone === true;
    return standalone || iosStandalone;
  } catch {
    return false;
  }
}

export function useInstallPrompt(): UseInstallPromptResult {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | undefined>();
  const [isInstalled, setInstalled] = useState(detectInstalled);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      // Suppress the browser's own banner so the prompt appears where it makes sense.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setInstalled(true);
      setDeferred(undefined);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (deferred === undefined) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      // The prompt can only be shown once; a failure is not worth surfacing.
    } finally {
      setDeferred(undefined);
    }
  }, [deferred]);

  return {
    canInstall: deferred !== undefined && !isInstalled && !dismissed,
    isInstalled,
    install,
    dismiss: useCallback(() => setDismissed(true), []),
  };
}

/** Whether the browser currently believes it is online. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
