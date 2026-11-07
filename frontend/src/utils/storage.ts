import { logger } from '@/utils/logger';
import { isTauri } from '@tauri-apps/api/core';

const AUTH_TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const AUTH_STORE_PATH = 'auth.store.json';
const CHAT_EVENT_ID_PREFIX = 'chat:';
const CHAT_EVENT_ID_SUFFIX = ':lastEventId';
const MAX_CHAT_EVENT_ID_ENTRIES = 500;

interface AuthStoreBackend {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  save(): Promise<void>;
}

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch (error) {
    logger.error('LocalStorage access failed', 'storage.getStorage', error);
    return null;
  }
};

export const safeGetItem = (key: string): string | null => {
  const storageInstance = getStorage();
  if (!storageInstance) {
    return null;
  }

  try {
    return storageInstance.getItem(key);
  } catch (error) {
    logger.error('LocalStorage get failed', 'storage.safeGetItem', error);
    return null;
  }
};

export const safeSetItem = (key: string, value: string): void => {
  const storageInstance = getStorage();
  if (!storageInstance) {
    return;
  }

  try {
    storageInstance.setItem(key, value);
  } catch (error) {
    logger.error('LocalStorage set failed', 'storage.safeSetItem', error);
  }
};

export const safeRemoveItem = (key: string): void => {
  const storageInstance = getStorage();
  if (!storageInstance) {
    return;
  }

  try {
    storageInstance.removeItem(key);
  } catch (error) {
    logger.error('LocalStorage remove failed', 'storage.safeRemoveItem', error);
  }
};

// One Tauri store load in flight; cleared on failure so the next call retries.
let desktopStorePromise: Promise<AuthStoreBackend | null> | null = null;

async function getDesktopAuthStore(): Promise<AuthStoreBackend | null> {
  if (!isTauri()) {
    return null;
  }
  if (desktopStorePromise) {
    try {
      return await desktopStorePromise;
    } catch (error) {
      desktopStorePromise = null;
      logger.error('Desktop auth store init failed', 'storage.getDesktopAuthStore', error);
      return null;
    }
  }

  desktopStorePromise = (async () => {
    const { load } = await import('@tauri-apps/plugin-store');
    return await load(AUTH_STORE_PATH, { defaults: {}, autoSave: false });
  })();

  try {
    return await desktopStorePromise;
  } catch (error) {
    desktopStorePromise = null;
    logger.error('Desktop auth store init failed', 'storage.getDesktopAuthStore', error);
    return null;
  }
}

let cachedToken: string | null = null;
let cachedRefreshToken: string | null = null;
let tokenCacheInitialized = false;

async function persistDesktopAuthState(): Promise<void> {
  const store = await getDesktopAuthStore();
  if (!store) {
    return;
  }

  try {
    if (cachedToken) {
      await store.set(AUTH_TOKEN_KEY, cachedToken);
    } else {
      await store.delete(AUTH_TOKEN_KEY);
    }

    if (cachedRefreshToken) {
      await store.set(REFRESH_TOKEN_KEY, cachedRefreshToken);
    } else {
      await store.delete(REFRESH_TOKEN_KEY);
    }

    await store.save();
  } catch (error) {
    logger.error('Desktop auth store persist failed', 'storage.persistDesktopAuthState', error);
  }
}

function initTokenCacheFromLocalStorage(): void {
  if (tokenCacheInitialized) return;
  cachedToken = safeGetItem(AUTH_TOKEN_KEY);
  cachedRefreshToken = safeGetItem(REFRESH_TOKEN_KEY);
  tokenCacheInitialized = true;
}

// Tauri secure store on desktop, localStorage in browser. In-memory cache for
// sync getToken() on the API hot path; writes go to the backing store async.
export const authStorage = {
  hydrate: async (): Promise<void> => {
    if (tokenCacheInitialized) {
      return;
    }

    if (!isTauri()) {
      initTokenCacheFromLocalStorage();
      return;
    }

    const store = await getDesktopAuthStore();
    if (store) {
      try {
        const persistedToken = await store.get<string>(AUTH_TOKEN_KEY);
        const persistedRefreshToken = await store.get<string>(REFRESH_TOKEN_KEY);

        cachedToken = persistedToken ?? null;
        cachedRefreshToken = persistedRefreshToken ?? null;
      } catch (error) {
        logger.error('Desktop auth store read failed', 'storage.authStorage.hydrate', error);
      }
    }

    tokenCacheInitialized = true;
  },
  getToken: (): string | null => {
    if (!tokenCacheInitialized && !isTauri()) {
      initTokenCacheFromLocalStorage();
    }
    return cachedToken;
  },
  getRefreshToken: (): string | null => {
    if (!tokenCacheInitialized && !isTauri()) {
      initTokenCacheFromLocalStorage();
    }
    return cachedRefreshToken;
  },
  reload: (): void => {
    if (isTauri() || !getStorage()) {
      return;
    }
    tokenCacheInitialized = false;
    initTokenCacheFromLocalStorage();
  },
  setTokens: async (token: string, refreshToken: string): Promise<void> => {
    cachedToken = token;
    cachedRefreshToken = refreshToken;
    tokenCacheInitialized = true;

    if (isTauri()) {
      // Await so refresh rotation can't finish before the new token hits disk.
      await persistDesktopAuthState();
      safeRemoveItem(AUTH_TOKEN_KEY);
      safeRemoveItem(REFRESH_TOKEN_KEY);
      return;
    }

    safeSetItem(AUTH_TOKEN_KEY, token);
    safeSetItem(REFRESH_TOKEN_KEY, refreshToken);
  },
  clearAuth: (): void => {
    cachedToken = null;
    cachedRefreshToken = null;
    tokenCacheInitialized = true;

    if (isTauri()) {
      void persistDesktopAuthState();
      safeRemoveItem(AUTH_TOKEN_KEY);
      safeRemoveItem(REFRESH_TOKEN_KEY);
      return;
    }

    safeRemoveItem(AUTH_TOKEN_KEY);
    safeRemoveItem(REFRESH_TOKEN_KEY);
  },
};

// Cross-tab: another tab rotating tokens must update this tab's memory cache
// or the next refresh replays a rotated-away token.
if (typeof window !== 'undefined' && !isTauri()) {
  window.addEventListener('storage', (event) => {
    if (event.key === AUTH_TOKEN_KEY) {
      cachedToken = event.newValue;
    } else if (event.key === REFRESH_TOKEN_KEY) {
      cachedRefreshToken = event.newValue;
    }
  });
}

// Per-chat SSE last-seq for resume after refresh; pruned to bound storage.
export const chatStorage = {
  getEventId: (chatId: string): string | null =>
    safeGetItem(`${CHAT_EVENT_ID_PREFIX}${chatId}${CHAT_EVENT_ID_SUFFIX}`),
  setEventId: (chatId: string, eventId: string): void =>
    safeSetItem(`${CHAT_EVENT_ID_PREFIX}${chatId}${CHAT_EVENT_ID_SUFFIX}`, eventId),
  removeEventId: (chatId: string): void =>
    safeRemoveItem(`${CHAT_EVENT_ID_PREFIX}${chatId}${CHAT_EVENT_ID_SUFFIX}`),
  pruneStaleEntries: (): void => {
    const storage = getStorage();
    if (!storage) return;

    const entries: { key: string; seq: number }[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(CHAT_EVENT_ID_PREFIX) && key.endsWith(CHAT_EVENT_ID_SUFFIX)) {
        const val = storage.getItem(key);
        entries.push({ key, seq: Number(val) || 0 });
      }
    }

    if (entries.length <= MAX_CHAT_EVENT_ID_ENTRIES) return;

    entries.sort((a, b) => b.seq - a.seq);
    for (let i = MAX_CHAT_EVENT_ID_ENTRIES; i < entries.length; i++) {
      storage.removeItem(entries[i].key);
    }
  },
};
