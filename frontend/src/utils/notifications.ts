import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import type { PermissionRequest } from '@/types/chat.types';
import { logger } from '@/utils/logger';

// Dedup OS notifications when SSE envelopes replay on reconnect.
const NOTIFIED_PERMISSION_REQUESTS = new Set<string>();

// The OS clips long bodies anyway.
const BODY_MAX_CHARS = 200;

// Notify-or-not policy lives in useBackgroundNotify; this module formats and sends.
export interface NotifyOptions {
  // The assistant's reply — becomes the notification body.
  message?: string;
  // Web only: invoked after focusing the window. Tauri clicks activate the app natively.
  onClick?: () => void;
}

function buildPermissionNotification(request: PermissionRequest): {
  title: string;
  body: string;
} {
  switch (request.tool_name) {
    case 'ExitPlanMode':
      return {
        title: 'Plan ready for approval',
        body: 'Review the plan and approve or reject it.',
      };
    default:
      return {
        title: 'Permission needed',
        body: `Tool "${request.tool_name}" is waiting for your approval.`,
      };
  }
}

async function sendWebNotification(
  title: string,
  body: string,
  onClick?: () => void,
): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  // Prompting here would be ignored outside a user gesture — useNotificationPermissionPrompt asks.
  if (Notification.permission !== 'granted') {
    return false;
  }

  const notification = new Notification(title, { body });
  notification.onclick = () => {
    window.focus();
    onClick?.();
    notification.close();
  };
  return true;
}

async function sendTauriNotification(title: string, body: string): Promise<boolean> {
  let permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    permissionGranted = (await requestPermission()) === 'granted';
  }

  if (!permissionGranted) {
    return false;
  }
  sendNotification({ title, body });
  return true;
}

// Resolves to whether a notification was actually shown.
async function deliver(title: string, body: string, onClick?: () => void): Promise<boolean> {
  if (isTauri()) {
    return sendTauriNotification(title, body);
  }

  return sendWebNotification(title, body, onClick);
}

// Web only — call from a user gesture so the browser honors the prompt.
export async function requestNotificationPermission(): Promise<void> {
  try {
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'default'
    ) {
      await Notification.requestPermission();
    }
  } catch (error) {
    logger.debug('Failed to request notification permission', 'notifications', error);
  }
}

// Notifications the user hasn't come back to yet.
let unseenNotifications = 0;

async function syncAppBadge(count: number): Promise<void> {
  try {
    if (isTauri()) {
      // App-wide dock/taskbar badge; undefined clears it.
      await getCurrentWindow().setBadgeCount(count > 0 ? count : undefined);
      return;
    }

    // Badging API only has an effect for installed PWAs.
    if ('setAppBadge' in navigator) {
      if (count > 0) {
        await navigator.setAppBadge(count);
      } else {
        await navigator.clearAppBadge();
      }
    }
  } catch (error) {
    logger.debug('Failed to sync app badge', 'notifications', error);
  }
}

export async function bumpAppBadge(): Promise<void> {
  unseenNotifications += 1;
  await syncAppBadge(unseenNotifications);
}

export async function resetAppBadge(): Promise<void> {
  if (unseenNotifications === 0) return;
  unseenNotifications = 0;
  await syncAppBadge(0);
}

function assistantBody(message: string | undefined): string {
  const text = message?.trim();
  if (!text) return 'The assistant has finished responding.';
  return text.length > BODY_MAX_CHARS ? `${text.slice(0, BODY_MAX_CHARS).trimEnd()}…` : text;
}

export async function notifyStreamComplete(options: NotifyOptions = {}): Promise<boolean> {
  try {
    return await deliver('Task completed', assistantBody(options.message), options.onClick);
  } catch (error) {
    logger.debug('Failed to send stream complete notification', 'notifications', error);
    return false;
  }
}

export async function notifyPermissionRequest(
  request: PermissionRequest,
  options: NotifyOptions = {},
): Promise<boolean> {
  // Claimed synchronously so concurrent replays can't double-notify, and
  // released below if nothing was shown so a later replay can still notify.
  if (NOTIFIED_PERMISSION_REQUESTS.has(request.request_id)) {
    return false;
  }
  NOTIFIED_PERMISSION_REQUESTS.add(request.request_id);

  const { title, body } = buildPermissionNotification(request);

  try {
    const delivered = await deliver(title, body, options.onClick);
    if (!delivered) {
      NOTIFIED_PERMISSION_REQUESTS.delete(request.request_id);
    }
    return delivered;
  } catch (error) {
    NOTIFIED_PERMISSION_REQUESTS.delete(request.request_id);
    logger.debug('Failed to send permission notification', 'notifications', error);
    return false;
  }
}
