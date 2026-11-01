// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, remoteApiClient, setCloudApiBaseUrl } from './api';
import { authStorage, cloudAuthStorage } from '@/utils/storage';
import { isCloudChat, markCloudChats } from '@/utils/chatOrigin';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const tokens = (access: string, refresh: string) =>
  json({ access_token: access, refresh_token: refresh, token_type: 'bearer' });

const fetchMock = vi.fn<typeof fetch>();
const isRefresh = (url: unknown) => String(url).endsWith('/auth/jwt/refresh');
const bearerOf = (init?: RequestInit) =>
  (init?.headers as Record<string, string> | undefined)?.Authorization;

beforeEach(async () => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  await authStorage.setTokens('old-access', 'old-refresh');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('APIClient token refresh', () => {
  it('shares one refresh across concurrent 401s and retries each with the new token', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (isRefresh(url)) return tokens('new-access', 'new-refresh');
      return bearerOf(init) === 'Bearer new-access'
        ? json({ path: new URL(String(url)).pathname })
        : json({ detail: 'expired' }, 401);
    });

    const results = await Promise.all([apiClient.get('/a'), apiClient.get('/b')]);

    expect(results).toEqual([{ path: '/api/v1/a' }, { path: '/api/v1/b' }]);
    expect(fetchMock.mock.calls.filter(([url]) => isRefresh(url))).toHaveLength(1);
    expect(authStorage.getRefreshToken()).toBe('new-refresh');
  });

  it('keeps the session when the refresh fails transiently', async () => {
    fetchMock.mockImplementation(async (url) =>
      isRefresh(url) ? json({ detail: 'down' }, 503) : json({ detail: 'expired' }, 401),
    );

    await expect(apiClient.get('/a')).rejects.toThrow('Token refresh failed');

    expect(authStorage.getToken()).toBe('old-access');
    expect(authStorage.getRefreshToken()).toBe('old-refresh');
  });

  it('disconnects the cloud when the VPS refresh token is rejected', async () => {
    useCloudSettingsStore.getState().setCloud('https://vps.example', 'me@example.com');
    setCloudApiBaseUrl('https://vps.example');
    await cloudAuthStorage.setTokens('cloud-access', 'cloud-refresh');
    markCloudChats(['cloud-chat']);
    fetchMock.mockResolvedValue(json({ detail: 'invalid' }, 401));

    await expect(remoteApiClient.get('/chat/chats')).rejects.toThrow('Session expired');

    expect(cloudAuthStorage.getRefreshToken()).toBeNull();
    expect(isCloudChat('cloud-chat')).toBe(false);
    expect(useCloudSettingsStore.getState()).toMatchObject({ cloudUrl: '', connectedEmail: null });
    expect(authStorage.getToken()).toBe('old-access');
  });
});
