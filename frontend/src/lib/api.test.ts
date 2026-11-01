// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { onSessionExpired } = vi.hoisted(() => ({ onSessionExpired: vi.fn() }));

vi.mock('@/utils/authSession', () => ({ invalidateSessionAndRedirect: onSessionExpired }));

import { apiClient, remoteApiClient, resolveChatClient, resolveSandboxClient } from './api';
import { NetworkError } from '@/types/errors.types';
import { markCloudChats, markCloudSandboxes } from '@/utils/chatOrigin';
import { authStorage } from '@/utils/storage';

const json = (body: unknown, status = 200) =>
  new Response(body == null ? '' : JSON.stringify(body), { status });
const tokens = (access: string, refresh: string) =>
  json({ access_token: access, refresh_token: refresh, token_type: 'bearer' });
const bearerOf = (init?: RequestInit) =>
  (init?.headers as Record<string, string> | undefined)?.Authorization;

const fetchMock = vi.fn<typeof fetch>();

// An empty refresh token reads as "none".
const signIn = (access: string, refresh = '') => authStorage.setTokens(access, refresh);

beforeEach(async () => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  localStorage.clear();
  vi.stubGlobal('fetch', fetchMock);
  await signIn('access');
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  it('converts fetch rejections to NetworkError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Load failed'));
    await expect(apiClient.get('/thing')).rejects.toBeInstanceOf(NetworkError);
  });

  it('rethrows fetch aborts unchanged', async () => {
    const error = new DOMException('The operation was aborted', 'AbortError');
    fetchMock.mockRejectedValueOnce(error);
    await expect(apiClient.get('/thing')).rejects.toBe(error);
  });
});

describe('APIClient 401 handling', () => {
  it('refreshes the token, persists it, and retries once with the new bearer', async () => {
    await signIn('access', 'refresh-tok');
    fetchMock
      .mockResolvedValueOnce(json({ message: 'unauth' }, 401))
      .mockResolvedValueOnce(tokens('a2', 'r2'))
      .mockResolvedValueOnce(json({ ok: true }));

    await expect(apiClient.get('/thing')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(bearerOf(fetchMock.mock.calls[2][1])).toBe('Bearer a2');
    expect(authStorage.getToken()).toBe('a2');
    expect(authStorage.getRefreshToken()).toBe('r2');
  });

  it('tears down the session on a 401 with no refresh token', async () => {
    fetchMock.mockResolvedValueOnce(json({ message: 'unauth' }, 401));

    await expect(apiClient.get('/thing')).rejects.toThrow('Session expired');
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('tears down the session when the refresh itself returns 401', async () => {
    await signIn('access', 'refresh-tok');
    fetchMock
      .mockResolvedValueOnce(json({ message: 'unauth' }, 401))
      .mockResolvedValueOnce(json({ message: 'dead' }, 401));

    await expect(apiClient.get('/thing')).rejects.toThrow('Session expired');
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });
});

describe('getValidToken', () => {
  // Only the base64 payload's exp claim is read.
  const jwtWithExp = (expSecs: number) => `h.${btoa(JSON.stringify({ exp: expSecs }))}.s`;

  it('reuses a cached access token that is not near expiry, without refreshing', async () => {
    const token = jwtWithExp(Math.floor(Date.now() / 1000) + 3600);
    await signIn(token, 'refresh-tok');

    await expect(apiClient.getValidToken()).resolves.toBe(token);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['expired', jwtWithExp(Math.floor(Date.now() / 1000) - 10)],
    ['not a decodable JWT', 'opaque-garbage'],
  ])('refreshes when the cached access token is %s', async (_label, cached) => {
    await signIn(cached, 'refresh-tok');
    fetchMock.mockResolvedValueOnce(tokens('fresh', 'r2'));

    await expect(apiClient.getValidToken()).resolves.toBe('fresh');
    expect(authStorage.getToken()).toBe('fresh');
  });

  it('returns the cached token as-is when there is no refresh token', async () => {
    await signIn('whatever');

    await expect(apiClient.getValidToken()).resolves.toBe('whatever');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tears down the session and returns null when the refresh 401s', async () => {
    await signIn('opaque-garbage', 'refresh-tok');
    fetchMock.mockResolvedValueOnce(json({ message: 'dead' }, 401));

    await expect(apiClient.getValidToken()).resolves.toBeNull();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });
});

describe('client routing', () => {
  it('routes cloud chats to the remote client and everything else locally', () => {
    markCloudChats(['cloud-chat']);
    expect(resolveChatClient('cloud-chat')).toBe(remoteApiClient);
    expect(resolveChatClient('local-chat')).toBe(apiClient);
    expect(resolveChatClient(undefined)).toBe(apiClient);
  });

  it('routes cloud sandboxes to the remote client and everything else locally', () => {
    markCloudSandboxes(['cloud-sbx']);
    expect(resolveSandboxClient('cloud-sbx')).toBe(remoteApiClient);
    expect(resolveSandboxClient('local-sbx')).toBe(apiClient);
    expect(resolveSandboxClient(undefined)).toBe(apiClient);
  });
});
