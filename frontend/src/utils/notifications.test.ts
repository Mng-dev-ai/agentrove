import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PermissionRequest } from '@/types/chat.types';

const { isTauri, isPermissionGranted, requestPermission, sendNotification, debug } = vi.hoisted(
  () => ({
    isTauri: vi.fn(() => true),
    isPermissionGranted: vi.fn(async () => true),
    requestPermission: vi.fn(async () => 'granted'),
    sendNotification: vi.fn(),
    debug: vi.fn(),
  }),
);

vi.mock('@tauri-apps/api/core', () => ({ isTauri }));
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
  isPermissionGranted.mockResolvedValue(true);
  requestPermission.mockResolvedValue('granted');
  sendNotification.mockClear();
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

  it('does not send when permission is denied', async () => {
    isPermissionGranted.mockResolvedValueOnce(false);
    requestPermission.mockResolvedValueOnce('denied');
    const { notifyPermissionRequest } = await load();
    await notifyPermissionRequest(request());

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('swallows notification errors and logs them', async () => {
    isPermissionGranted.mockRejectedValueOnce(new Error('nope'));
    const { notifyPermissionRequest } = await load();

    await expect(notifyPermissionRequest(request())).resolves.toBeUndefined();
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
});
