import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { requestNotificationPermission } from '@/utils/notifications';

// Browsers only honor the permission prompt inside a user gesture, so arm a
// one-shot listener for the first one after sign-in. Settings must resolve
// before arming — a gesture-time fetch would outlive the activation window.
export function useNotificationPermissionPrompt(enabled: boolean): void {
  const { data } = useSettingsQuery({ enabled });
  // undefined until loaded — don't arm until it is explicitly on.
  const notificationsOn = data?.notifications_enabled;

  useEffect(() => {
    if (!enabled || isTauri() || !notificationsOn) return;
    if (!('Notification' in window) || Notification.permission !== 'default') return;

    const controller = new AbortController();
    const ask = () => {
      controller.abort();
      void requestNotificationPermission();
    };
    const options = { signal: controller.signal };
    window.addEventListener('pointerdown', ask, options);
    window.addEventListener('keydown', ask, options);
    return () => controller.abort();
  }, [enabled, notificationsOn]);
}
