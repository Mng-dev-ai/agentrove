// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PermissionRequest } from '@/types/chat.types';

const { isTauri, isPermissionGranted, requestPermission, sendNotification, setBadgeCount, debug } =
  vi.hoisted(() => ({
    isTauri: vi.fn(() => true),
    isPermissionGranted: vi.fn(async () => true),
    requestPermission: vi.fn(async () => 'granted'),
    sendNotification: vi.fn(),
    setBadgeCount: vi.fn(async () => {}),
    debug: vi.fn(),
  }));

vi.mock('@tauri-apps/api/core', () => ({ isTauri }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ setBadgeCount }) }));
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted,
  requestPermission,
  sendNotification,
}));
vi.mock('@/utils/logger', () => ({ logger: { debug } }));

// Fresh module per test so the module-level dedup Set resets.
async function load() {
  vi.resetModules();
  return import('./notifications');
}

const request = (overrides: Partial<PermissionRequest> = {}): PermissionRequest =>
  ({ request_id: 'r1', tool_name: 'Bash', ...overrides }) as PermissionRequest;

beforeEach(() => {
  isTauri.mockReturnValue(true);
  isPermissionGranted.mockClear();
  isPermissionGranted.mockResolvedValue(true);
  requestPermission.mockClear();
  requestPermission.mockResolvedValue('granted');
  sendNotification.mockClear();
  setBadgeCount.mockClear();
  setBadgeCount.mockResolvedValue(undefined);
  debug.mockClear();
});

describe('notifyPermissionRequest', () => {
  it('sends a generic permission notification for an arbitrary tool', async () => {
    const { notifyPermissionRequest } = await load();
    await notifyPermissionRequest(request({ tool_name: 'Bash' }));

    expect(sendNotification).toHaveBeenCalledWith({
      title: 'Permission needed',
      body: 'Tool "Bash" is waiting for your approval.',
    });
  });

  it('uses plan-specific copy for ExitPlanMode', async () => {
    const { notifyPermissionRequest } = await load();
    await notifyPermissionRequest(request({ tool_name: 'ExitPlanMode' }));

    expect(sendNotification).toHaveBeenCalledWith({
      title: 'Plan ready for approval',
      body: 'Review the plan and approve or reject it.',
    });
  });

  it('deduplicates repeat notifications for the same request id', async () => {
    const { notifyPermissionRequest } = await load();
    await notifyPermissionRequest(request({ request_id: 'dup' }));
    await notifyPermissionRequest(request({ request_id: 'dup' }));

    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('requests OS permission when not already granted', async () => {
    isPermissionGranted.mockResolvedValueOnce(false);
    const { notifyPermissionRequest } = await load();
    await notifyPermissionRequest(request());

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('does not send when permission is denied, and a replay after granting still notifies', async () => {
    isPermissionGranted.mockResolvedValueOnce(false);
    requestPermission.mockResolvedValueOnce('denied');
    const { notifyPermissionRequest } = await load();
    await notifyPermissionRequest(request());
    expect(sendNotification).not.toHaveBeenCalled();

    // Nothing was shown, so the dedupe key must not be burned.
    await notifyPermissionRequest(request());
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('releases the dedupe key on the web permission-default path', async () => {
    isTauri.mockReturnValue(false);
    const instances: unknown[] = [];
    class FakeNotification {
      static permission = 'default';
      onclick: (() => void) | null = null;
      close = vi.fn();
      constructor() {
        instances.push(this);
      }
    }
    vi.stubGlobal('Notification', FakeNotification);

    try {
      const { notifyPermissionRequest } = await load();
      await notifyPermissionRequest(request({ request_id: 'pending' }));
      expect(instances).toHaveLength(0);

      // User granted via the first-gesture prompt; a replay must still notify…
      FakeNotification.permission = 'granted';
      await notifyPermissionRequest(request({ request_id: 'pending' }));
      expect(instances).toHaveLength(1);

      // …and only once.
      await notifyPermissionRequest(request({ request_id: 'pending' }));
      expect(instances).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('swallows notification errors and logs them', async () => {
    isPermissionGranted.mockRejectedValueOnce(new Error('nope'));
    const { notifyPermissionRequest } = await load();

    await expect(notifyPermissionRequest(request())).resolves.toBe(false);
    expect(debug).toHaveBeenCalledTimes(1);
  });
});

describe('app badge', () => {
  it('counts up with each delivered notification', async () => {
    const { bumpAppBadge } = await load();
    await bumpAppBadge();
    await bumpAppBadge();

    expect(setBadgeCount).toHaveBeenNthCalledWith(1, 1);
    expect(setBadgeCount).toHaveBeenNthCalledWith(2, 2);
  });

  it('clears the badge on reset and starts over afterwards', async () => {
    const { bumpAppBadge, resetAppBadge } = await load();
    await bumpAppBadge();
    await resetAppBadge();
    expect(setBadgeCount).toHaveBeenLastCalledWith(undefined);

    await bumpAppBadge();
    expect(setBadgeCount).toHaveBeenLastCalledWith(1);
  });

  it('skips the reset round-trip when nothing is badged', async () => {
    const { resetAppBadge } = await load();
    await resetAppBadge();

    expect(setBadgeCount).not.toHaveBeenCalled();
  });

  it('falls back to the web Badging API outside Tauri', async () => {
    isTauri.mockReturnValue(false);
    const setAppBadge = vi.fn(async () => {});
    const clearAppBadge = vi.fn(async () => {});
    Object.assign(navigator, { setAppBadge, clearAppBadge });

    try {
      const { bumpAppBadge, resetAppBadge } = await load();
      await bumpAppBadge();
      expect(setAppBadge).toHaveBeenCalledWith(1);

      await resetAppBadge();
      expect(clearAppBadge).toHaveBeenCalledTimes(1);
      expect(setBadgeCount).not.toHaveBeenCalled();
    } finally {
      delete (navigator as { setAppBadge?: unknown }).setAppBadge;
      delete (navigator as { clearAppBadge?: unknown }).clearAppBadge;
    }
  });

  it('swallows badge errors and logs them', async () => {
    setBadgeCount.mockRejectedValueOnce(new Error('nope'));
    const { bumpAppBadge } = await load();

    await expect(bumpAppBadge()).resolves.toBeUndefined();
    expect(debug).toHaveBeenCalledTimes(1);
  });
});

describe('notifyStreamComplete', () => {
  it('sends a completion notification', async () => {
    const { notifyStreamComplete } = await load();
    await notifyStreamComplete();

    expect(sendNotification).toHaveBeenCalledWith({
      title: 'Task completed',
      body: 'The assistant has finished responding.',
    });
  });

  it("uses the assistant's reply as the body", async () => {
    const { notifyStreamComplete } = await load();
    await notifyStreamComplete({ message: '  Renamed the auth guard and updated its tests.  ' });

    expect(sendNotification).toHaveBeenCalledWith({
      title: 'Task completed',
      body: 'Renamed the auth guard and updated its tests.',
    });
  });

  it('truncates a long reply and falls back when the reply is empty', async () => {
    const { notifyStreamComplete } = await load();
    await notifyStreamComplete({ message: 'x'.repeat(250) });
    expect(sendNotification).toHaveBeenLastCalledWith({
      title: 'Task completed',
      body: `${'x'.repeat(200)}…`,
    });

    await notifyStreamComplete({ message: '   ' });
    expect(sendNotification).toHaveBeenLastCalledWith({
      title: 'Task completed',
      body: 'The assistant has finished responding.',
    });
  });

  // Pins deliberate web behavior: OS-default auto-dismiss, click → focus + route + close.
  it('sends a plain auto-dismissing web notification whose click focuses and routes', async () => {
    isTauri.mockReturnValue(false);
    const instances: FakeNotification[] = [];
    class FakeNotification {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      close = vi.fn();
      constructor(
        public title: string,
        public options?: { body?: string },
      ) {
        instances.push(this);
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});

    try {
      const { notifyStreamComplete } = await load();
      const onClick = vi.fn();
      await notifyStreamComplete({ message: 'Done.', onClick });

      expect(instances).toHaveLength(1);
      expect(instances[0].title).toBe('Task completed');
      expect(instances[0].options).toEqual({ body: 'Done.' });

      instances[0].onclick?.();
      expect(focus).toHaveBeenCalledTimes(1);
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(instances[0].close).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      focus.mockRestore();
    }
  });
});

describe('requestNotificationPermission', () => {
  it('prompts the browser while permission is undecided', async () => {
    const browserRequest = vi.fn(async () => 'granted');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: browserRequest });

    try {
      const { requestNotificationPermission } = await load();
      await requestNotificationPermission();
      expect(browserRequest).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does nothing once permission is decided', async () => {
    const browserRequest = vi.fn(async () => 'granted');
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: browserRequest });

    try {
      const { requestNotificationPermission } = await load();
      await requestNotificationPermission();
      expect(browserRequest).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
