// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }));

// Fresh module per test so the in-memory token cache resets between cases.
async function load() {
  vi.resetModules();
  return import('./storage');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('safe localStorage helpers', () => {
  it('swallow storage failures instead of throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { safeGetItem, safeSetItem } = await load();
    expect(safeGetItem('k')).toBeNull();
    expect(() => safeSetItem('k', 'v')).not.toThrow();
  });
});

describe('authStorage (browser backend)', () => {
  it('persists and reads back both tokens', async () => {
    const { authStorage } = await load();
    await authStorage.setTokens('tok', 'refresh');
    expect(authStorage.getToken()).toBe('tok');
    expect(authStorage.getRefreshToken()).toBe('refresh');
    expect(localStorage.getItem('auth_token')).toBe('tok');
    expect(localStorage.getItem('refresh_token')).toBe('refresh');
  });

  it('hydrates the token cache from pre-existing localStorage', async () => {
    localStorage.setItem('auth_token', 'existing');
    const { authStorage } = await load();
    expect(authStorage.getToken()).toBe('existing');
  });

  it('clears both tokens on clearAuth', async () => {
    const { authStorage } = await load();
    await authStorage.setTokens('a', 'r');

    authStorage.clearAuth();
    expect(authStorage.getToken()).toBeNull();
    expect(authStorage.getRefreshToken()).toBeNull();
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
  });

  it('applies token changes from other tabs via the storage event', async () => {
    const { authStorage } = await load();
    await authStorage.setTokens('tok', 'refresh');

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'refresh_token', newValue: 'rotated' }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'auth_token', newValue: 'fresh' }));

    expect(authStorage.getRefreshToken()).toBe('rotated');
    expect(authStorage.getToken()).toBe('fresh');
  });
});

describe('cloudAuthStorage (browser backend)', () => {
  it('keeps the access token in memory and persists only the refresh token', async () => {
    const { cloudAuthStorage } = await load();
    await cloudAuthStorage.setTokens('cloud-access', 'cloud-refresh');
    expect(cloudAuthStorage.getAccessToken()).toBe('cloud-access');
    expect(cloudAuthStorage.getRefreshToken()).toBe('cloud-refresh');
    expect(localStorage.getItem('cloud_refresh_token')).toBe('cloud-refresh');
    expect(Object.values(localStorage)).not.toContain('cloud-access');
  });

  it('clears everything on clear', async () => {
    const { cloudAuthStorage } = await load();
    await cloudAuthStorage.setTokens('x', 'cloud-refresh');

    cloudAuthStorage.clear();
    expect(cloudAuthStorage.getAccessToken()).toBeNull();
    expect(cloudAuthStorage.getRefreshToken()).toBeNull();
    expect(localStorage.getItem('cloud_refresh_token')).toBeNull();
  });

  it('applies cloud refresh token changes from other tabs via the storage event', async () => {
    const { cloudAuthStorage } = await load();
    await cloudAuthStorage.setTokens('a', 'cloud-refresh');

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'cloud_refresh_token', newValue: 'rotated' }),
    );

    expect(cloudAuthStorage.getRefreshToken()).toBe('rotated');
    expect(cloudAuthStorage.getAccessToken()).toBe('a');
  });

  it('drops the memory-only access token when another tab disconnects', async () => {
    const { cloudAuthStorage } = await load();
    await cloudAuthStorage.setTokens('a', 'cloud-refresh');

    window.dispatchEvent(
      new StorageEvent('storage', { key: 'cloud_refresh_token', newValue: null }),
    );

    expect(cloudAuthStorage.getRefreshToken()).toBeNull();
    expect(cloudAuthStorage.getAccessToken()).toBeNull();
  });
});

describe('chatStorage event ids', () => {
  it('scopes event ids per chat under the chat: key namespace', async () => {
    const { chatStorage } = await load();
    chatStorage.setEventId('chat-a', '42');
    expect(chatStorage.getEventId('chat-a')).toBe('42');
    expect(localStorage.getItem('chat:chat-a:lastEventId')).toBe('42');
    expect(chatStorage.getEventId('chat-b')).toBeNull();

    chatStorage.removeEventId('chat-a');
    expect(chatStorage.getEventId('chat-a')).toBeNull();
  });

  it('prunes to the newest 500 entries, evicting the lowest seqs', async () => {
    for (let seq = 0; seq < 505; seq++) {
      localStorage.setItem(`chat:c${seq}:lastEventId`, String(seq));
    }
    const { chatStorage } = await load();
    chatStorage.pruneStaleEntries();

    const remaining = Object.keys(localStorage).filter(
      (k) => k.startsWith('chat:') && k.endsWith(':lastEventId'),
    );
    expect(remaining).toHaveLength(500);
    expect(chatStorage.getEventId('c0')).toBeNull();
    expect(chatStorage.getEventId('c4')).toBeNull();
    expect(chatStorage.getEventId('c5')).toBe('5');
    expect(chatStorage.getEventId('c504')).toBe('504');
  });

  it('leaves entries untouched when under the cap', async () => {
    const { chatStorage } = await load();
    chatStorage.setEventId('only', '1');
    chatStorage.pruneStaleEntries();
    expect(chatStorage.getEventId('only')).toBe('1');
  });
});
