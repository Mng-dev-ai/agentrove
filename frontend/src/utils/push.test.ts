// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isPushRegistered, registerPushDevice, unregisterPushDevice } from './push';

vi.mock('@/utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

const TOKEN_KEY = 'push-device-token';
const fetchMock = vi.fn<typeof fetch>();
const ok = () => new Response('', { status: 200 });
const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => `${init?.method} ${new URL(String(url)).pathname}`);

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('push device registration', () => {
  it('waits for an in-flight registration before unregistering the device', async () => {
    let finishRegister!: (response: Response) => void;
    fetchMock
      .mockReturnValueOnce(new Promise((resolve) => (finishRegister = resolve)))
      .mockResolvedValueOnce(ok());

    const registering = registerPushDevice('tok-1', false);
    const unregistering = unregisterPushDevice();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls()).toEqual(['POST /api/v1/push/devices']);

    finishRegister(ok());
    await registering;
    await unregistering;

    expect(calls()).toEqual(['POST /api/v1/push/devices', 'DELETE /api/v1/push/devices/tok-1']);
    expect(isPushRegistered()).toBe(false);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('unregisters a device persisted by a previous launch', async () => {
    localStorage.setItem(TOKEN_KEY, 'old-tok');
    fetchMock.mockResolvedValueOnce(ok());

    await unregisterPushDevice();

    expect(calls()).toEqual(['DELETE /api/v1/push/devices/old-tok']);
  });

  it('keeps the persisted token for a later retry when unregister fails, without throwing', async () => {
    fetchMock.mockResolvedValueOnce(ok()).mockRejectedValueOnce(new TypeError('offline'));
    await registerPushDevice('tok-2', true);
    expect(isPushRegistered()).toBe(true);

    await expect(unregisterPushDevice()).resolves.toBeUndefined();

    expect(isPushRegistered()).toBe(false);
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-2');
  });
});
