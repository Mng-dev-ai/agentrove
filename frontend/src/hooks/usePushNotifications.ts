import { useEffect } from 'react';
import { addPluginListener, invoke, isTauri } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { isMobileApp } from '@/utils/platform';
import { registerPushDevice } from '@/utils/push';
import { logger } from '@/utils/logger';

interface PushRegistration {
  token: string;
  sandbox: boolean;
}

// iOS shell only: register this phone for APNs and open the chat a tapped push points at.
export function usePushNotifications(enabled: boolean): void {
  const navigate = useNavigate();
  const { data } = useSettingsQuery({ enabled });
  const notificationsOn = data?.notifications_enabled;
  const active = enabled && isMobileApp() && isTauri();

  useEffect(() => {
    if (!active || !notificationsOn) return;
    // The OS permission prompt can outlive a logout; don't register after it.
    let cancelled = false;
    invoke<PushRegistration>('plugin:push|register')
      .then(({ token, sandbox }) => {
        if (!cancelled) return registerPushDevice(token, sandbox);
      })
      .catch((error) => logger.debug('Push registration failed', 'push', error));
    return () => {
      cancelled = true;
    };
  }, [active, notificationsOn]);

  useEffect(() => {
    if (!active) return;
    // The native side keeps the tapped path until taken. Plugin events sent while
    // the webview was suspended or not yet listening can be lost, so also check on
    // mount and whenever the app comes back to the foreground.
    const openTappedPath = () => {
      invoke<{ path: string | null }>('plugin:push|take_launch_path')
        .then(({ path }) => {
          if (path) navigate(path);
        })
        .catch((error) => logger.warn('Push tap routing failed', 'push', error));
    };
    const openWhenVisible = () => {
      if (document.visibilityState === 'visible') openTappedPath();
    };
    openTappedPath();
    document.addEventListener('visibilitychange', openWhenVisible);
    const listener = addPluginListener('push', 'tap', openTappedPath);
    return () => {
      document.removeEventListener('visibilitychange', openWhenVisible);
      void listener.then((handle) => handle.unregister());
    };
  }, [active, navigate]);
}
