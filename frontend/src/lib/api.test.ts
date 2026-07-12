// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getToken: vi.fn<() => string | null>(() => 'access'),
  getRefreshToken: vi.fn<() => string | null>(() => null),
  setTokens: vi.fn(async () => {}),
  onSessionExpired: vi.fn(),
  isCloudChat: vi.fn<(id: string) => boolean>(() => false),
  isCloudSandbox: vi.fn<(id: string) => boolean>(() => false),
  clearCloudOrigins: vi.fn(),
}));

vi.mock('@/utils/storage', () => ({
  authStorage: {
    getToken: h.getToken,
    getRefreshToken: h.getRefreshToken,
    setTokens: h.setTokens,
  },
  cloudAuthStorage: {
    getAccessToken: () => null,
    getRefreshToken: () => null,
    setTokens: vi.fn(async () => {}),
    clear: vi.fn(),
  },
}));
vi.mock('@/utils/authSession', () => ({ invalidateSessionAndRedirect: h.onSessionExpired }));
vi.mock('@/utils/chatOrigin', () => ({
  isCloudChat: h.isCloudChat,
  isCloudSandbox: h.isCloudSandbox,
  clearCloudOrigins: h.clearCloudOrigins,
}));
vi.mock('@/store/cloudSettingsStore', () => ({
  useCloudSettingsStore: { getState: () => ({ cloudUrl: '', clearCloud: vi.fn() }) },
}));

import {
  trimTrailingSlash,
  apiClient,
  remoteApiClient,
  resolveChatClient,
  resolveSandboxClient,
} from './api';

const json = (body: unknown, status = 200, statusText?: string) =>
  new Response(body == null ? '' : JSON.stringify(body), { status, statusText });

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  h.getToken.mockReturnValue('access');
  h.getRefreshToken.mockReturnValue(null);
  vi.stubGlobal('fetch', fetchMock);
});

describe('trimTrailingSlash', () => {
  it('strips one or more trailing slashes', () => {
    expect(trimTrailingSlash('http://x/api/v1///')).toBe('http://x/api/v1');
  });

  it('leaves a slash-free url untouched', () => {
    expect(trimTrailingSlash('http://x/api/v1')).toBe('http://x/api/v1');
  });
});

describe('APIClient success + error shaping', () => {
  it('parses a JSON body on success', async () => {
    fetchMock.mockResolvedValueOnce(json({ id: 7 }));
    await expect(apiClient.get('/thing')).resolves.toEqual({ id: 7 });
  });

  it('returns null for an empty 200 body', async () => {
    fetchMock.mockResolvedValueOnce(json(null, 200));
    await expect(apiClient.get('/thing')).resolves.toBeNull();
  });

  it('throws with the JSON `message` and attaches the status', async () => {
    fetchMock.mockResolvedValueOnce(json({ message: 'boom' }, 500));
    await expect(apiClient.get('/thing')).rejects.toMatchObject({ message: 'boom', status: 500 });
  });

  it('falls back to `detail` then statusText for the error message', async () => {
    fetchMock.mockResolvedValueOnce(json({ detail: 'nope' }, 422));
    await expect(apiClient.get('/thing')).rejects.toMatchObject({ message: 'nope' });

    fetchMock.mockResolvedValueOnce(
      new Response('plain text', { status: 500, statusText: 'Boom' }),
    );
    await expect(apiClient.get('/thing')).rejects.toMatchObject({ message: 'Boom' });
  });

  it('uses a status placeholder when the error body is empty', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(apiClient.get('/thing')).rejects.toMatchObject({
      message: 'HTTP error! status: 503',
    });
  });
});

describe('APIClient 401 handling', () => {
  it('refreshes the token and retries once on 401', async () => {
    h.getRefreshToken.mockReturnValue('refresh-tok');
    fetchMock
      .mockResolvedValueOnce(json({ message: 'unauth' }, 401)) // original request
      .mockResolvedValueOnce(
        json({ access_token: 'a2', refresh_token: 'r2', token_type: 'bearer' }),
      ) // refresh
      .mockResolvedValueOnce(json({ ok: true })); // retried request

    await expect(apiClient.get('/thing')).resolves.toEqual({ ok: true });
    expect(h.setTokens).toHaveBeenCalledWith('a2', 'r2');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('tears down the session on a 401 with no refresh token', async () => {
    h.getRefreshToken.mockReturnValue(null);
    fetchMock.mockResolvedValueOnce(json({ message: 'unauth' }, 401));

    await expect(apiClient.get('/thing')).rejects.toThrow('Session expired');
    expect(h.onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('tears down the session when the refresh itself returns 401', async () => {
    h.getRefreshToken.mockReturnValue('refresh-tok');
    fetchMock
      .mockResolvedValueOnce(json({ message: 'unauth' }, 401)) // original request
      .mockResolvedValueOnce(json({ message: 'dead' }, 401)); // refresh -> terminal

    await expect(apiClient.get('/thing')).rejects.toThrow('Session expired');
    expect(h.onSessionExpired).toHaveBeenCalledTimes(1);
  });
});

describe('getValidToken', () => {
  // Minimal JWT shape — only the base64url payload's exp claim is read.
  const jwtWithExp = (expSecs: number) => `h.${btoa(JSON.stringify({ exp: expSecs }))}.s`;

  it('reuses a cached access token that is not near expiry, without refreshing', async () => {
    const token = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    h.getToken.mockReturnValue(token);
    h.getRefreshToken.mockReturnValue('refresh-tok');

    await expect(apiClient.getValidToken()).resolves.toBe(token);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes when the cached access token is expired', async () => {
    h.getToken.mockReturnValue(jwtWithExp(Math.floor(Date.now() / 1000) - 10));
    h.getRefreshToken.mockReturnValue('refresh-tok');
    fetchMock.mockResolvedValueOnce(
      json({ access_token: 'fresh', refresh_token: 'r2', token_type: 'bearer' }),
    );

    await expect(apiClient.getValidToken()).resolves.toBe('fresh');
    expect(h.setTokens).toHaveBeenCalledWith('fresh', 'r2');
  });

  it('refreshes when the cached token is not a decodable JWT', async () => {
    h.getToken.mockReturnValue('opaque-garbage');
    h.getRefreshToken.mockReturnValue('refresh-tok');
    fetchMock.mockResolvedValueOnce(
      json({ access_token: 'fresh', refresh_token: 'r2', token_type: 'bearer' }),
    );

    await expect(apiClient.getValidToken()).resolves.toBe('fresh');
  });

  it('returns the cached token as-is when there is no refresh token', async () => {
    h.getToken.mockReturnValue('whatever');
    h.getRefreshToken.mockReturnValue(null);

    await expect(apiClient.getValidToken()).resolves.toBe('whatever');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tears down the session and returns null when the refresh 401s', async () => {
    h.getToken.mockReturnValue(null);
    h.getRefreshToken.mockReturnValue('refresh-tok');
    fetchMock.mockResolvedValueOnce(json({ message: 'dead' }, 401));

    await expect(apiClient.getValidToken()).resolves.toBeNull();
    expect(h.onSessionExpired).toHaveBeenCalledTimes(1);
  });
});

describe('client routing', () => {
  it('routes cloud chats to the remote client and local chats to the local client', () => {
    h.isCloudChat.mockImplementation((id) => id === 'cloud-chat');
    expect(resolveChatClient('cloud-chat')).toBe(remoteApiClient);
    expect(resolveChatClient('local-chat')).toBe(apiClient);
    expect(resolveChatClient(undefined)).toBe(apiClient);
  });

  it('routes cloud sandboxes to the remote client', () => {
    h.isCloudSandbox.mockImplementation((id) => id === 'cloud-sbx');
    expect(resolveSandboxClient('cloud-sbx')).toBe(remoteApiClient);
    expect(resolveSandboxClient('local-sbx')).toBe(apiClient);
    expect(resolveSandboxClient(undefined)).toBe(apiClient);
  });
});
