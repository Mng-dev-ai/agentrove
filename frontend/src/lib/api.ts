import { authStorage, cloudAuthStorage } from '@/utils/storage';
import { invalidateSessionAndRedirect } from '@/utils/authSession';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import { isCloudChat, isCloudSandbox, clearCloudOrigins } from '@/utils/chatOrigin';

type RequestMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RequestOptions extends RequestInit {
  data?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

class RefreshTokenError extends Error {
  status: number;

  constructor(status: number, message = 'Token refresh failed') {
    super(message);
    this.name = 'RefreshTokenError';
    this.status = status;
  }
}

export type { ApiStreamResponse as StreamResponse } from '@/types/stream.types';

export const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

const resolveHttpBaseUrl = (rawUrl: string): string =>
  trimTrailingSlash(new URL(rawUrl, window.location.origin).toString());

const resolveWsBaseUrl = (rawUrl: string): string => {
  const normalized = new URL(rawUrl, window.location.origin);
  normalized.protocol = ['https:', 'wss:'].includes(normalized.protocol) ? 'wss:' : 'ws:';
  return trimTrailingSlash(normalized.toString());
};

// Auth source for an APIClient instance. The local client reads/writes the
// shared authStorage; the remote (VPS) client uses cloudAuthStorage so the two
// instances authenticate independently and don't clobber each other's tokens.
interface ClientAuth {
  getToken: () => string | null;
  getRefreshToken: () => string | null;
  setTokens: (accessToken: string, refreshToken: string) => void;
  onSessionExpired: () => void;
}

const localAuth: ClientAuth = {
  getToken: () => authStorage.getToken(),
  getRefreshToken: () => authStorage.getRefreshToken(),
  setTokens: (accessToken, refreshToken) => {
    authStorage.setToken(accessToken);
    authStorage.setRefreshToken(refreshToken);
  },
  onSessionExpired: invalidateSessionAndRedirect,
};

const cloudAuth: ClientAuth = {
  getToken: () => cloudAuthStorage.getAccessToken(),
  getRefreshToken: () => cloudAuthStorage.getRefreshToken(),
  setTokens: (accessToken, refreshToken) => {
    cloudAuthStorage.setAccessToken(accessToken);
    cloudAuthStorage.setRefreshToken(refreshToken);
  },
  // A revoked/expired VPS refresh token can't be recovered silently — drop the
  // cloud credentials so the settings UI reflects a disconnected state.
  onSessionExpired: () => {
    cloudAuthStorage.clear();
    // Drop persisted cloud origin IDs too, matching manual disconnect — otherwise
    // stale IDs keep routing to the (now-gone) VPS and can misroute links after
    // reconnecting to a different VPS/account.
    clearCloudOrigins();
    useCloudSettingsStore.getState().clearCloud();
  },
};

// Desktop reinstalls can leave stale refresh tokens in local storage while the backend
// identity/session store resets. Treat refresh 401 as terminal to break retry loops.
function shouldInvalidateSession(error: unknown): boolean {
  return error instanceof RefreshTokenError && error.status === 401;
}

const extractErrorMessage = async (response: Response): Promise<string> => {
  try {
    const text = await response.text();
    if (!text) {
      return `HTTP error! status: ${response.status}`;
    }
    const error = JSON.parse(text);
    return error.message || error.detail || response.statusText;
  } catch {
    return response.statusText || 'An error occurred';
  }
};

class APIClient {
  private baseURL: string;
  private auth: ClientAuth;
  private refreshingPromise: Promise<TokenResponse> | null = null;

  constructor(baseURL: string, auth: ClientAuth) {
    this.baseURL = baseURL;
    this.auth = auth;
  }

  getBaseUrl(): string {
    return this.baseURL;
  }

  // Exposes the client's own token so callers (e.g. the SSE query-param) don't
  // re-derive the client↔token-store pairing already encoded in `auth`.
  getToken(): string | null {
    return this.auth.getToken();
  }

  // For SSE openers that bypass request(): the token rides the URL and the cached
  // one may be missing (after a restart) or expired (reopening a dead feed), so
  // mint a fresh one from the refresh token on every open.
  async getValidToken(): Promise<string | null> {
    if (!this.auth.getRefreshToken()) return this.auth.getToken();
    try {
      return (await this.refreshTokenIfNeeded()).access_token;
    } catch (error) {
      // Mirror request(): a terminal refresh failure means the session is dead —
      // tear it down instead of letting SSE reopen loops retry it forever.
      if (shouldInvalidateSession(error)) {
        this.auth.onSessionExpired();
        return null;
      }
      throw error;
    }
  }

  setBaseUrl(url: string): void {
    this.baseURL = url;
  }

  private authHeaders(includeContentType = true): Record<string, string> {
    const token = this.auth.getToken();
    return {
      ...(includeContentType ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  private async performTokenRefresh(): Promise<TokenResponse> {
    const refreshToken = this.auth.getRefreshToken();
    if (!refreshToken) {
      throw new RefreshTokenError(401, 'No refresh token available');
    }

    const response = await fetch(`${this.baseURL}/auth/jwt/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }).catch(() => {
      throw new RefreshTokenError(0);
    });

    if (!response.ok) {
      throw new RefreshTokenError(response.status);
    }

    const data: TokenResponse = await response.json();
    this.auth.setTokens(data.access_token, data.refresh_token);
    return data;
  }

  private async refreshTokenIfNeeded(): Promise<TokenResponse> {
    if (this.refreshingPromise) {
      return this.refreshingPromise;
    }

    this.refreshingPromise = this.performTokenRefresh();

    try {
      return await this.refreshingPromise;
    } finally {
      this.refreshingPromise = null;
    }
  }

  private async handleResponse<T>(response: Response): Promise<T | null> {
    if (!response.ok) {
      const errorMessage = await extractErrorMessage(response);
      const error = new Error(errorMessage) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  private async request<T>(
    endpoint: string,
    method: RequestMethod = 'GET',
    options: RequestOptions = {},
    additionalHeaders: Record<string, string> = {},
    isRetry = false,
  ): Promise<T | null> {
    const { data, formData, signal, ...customConfig } = options;

    const config: RequestInit = {
      method,
      headers: {
        ...this.authHeaders(!formData),
        ...additionalHeaders,
      },
      signal,
      ...customConfig,
    };

    if (data) {
      config.body = JSON.stringify(data);
    }

    if (formData) {
      config.body = formData;
    }

    const response = await fetch(`${this.baseURL}${endpoint}`, config);

    if (response.status === 401 && !isRetry && !endpoint.includes('/auth/jwt/')) {
      const hasRefreshToken = !!this.auth.getRefreshToken();
      if (hasRefreshToken) {
        try {
          await this.refreshTokenIfNeeded();
          return this.request<T>(endpoint, method, options, additionalHeaders, true);
        } catch (error) {
          if (shouldInvalidateSession(error)) {
            this.auth.onSessionExpired();
            throw new Error('Session expired');
          }
          throw error;
        }
      }
      // 401 with no refresh token — session is unusable, so tear it down rather
      // than leave the UI looking connected.
      this.auth.onSessionExpired();
      throw new Error('Session expired');
    }

    return this.handleResponse(response);
  }

  async get<T>(endpoint: string, signal?: AbortSignal) {
    return this.request<T>(endpoint, 'GET', { signal });
  }

  async post<T>(endpoint: string, data?: unknown, signal?: AbortSignal) {
    return this.request<T>(endpoint, 'POST', { data, signal });
  }

  async patch<T>(endpoint: string, data?: unknown, signal?: AbortSignal) {
    return this.request<T>(endpoint, 'PATCH', { data, signal });
  }

  async put<T>(endpoint: string, data?: unknown, signal?: AbortSignal) {
    return this.request<T>(endpoint, 'PUT', { data, signal });
  }

  async postForm<T>(endpoint: string, formData: FormData, signal?: AbortSignal) {
    return this.request<T>(endpoint, 'POST', { formData, signal });
  }

  async delete(endpoint: string, signal?: AbortSignal) {
    return this.request(endpoint, 'DELETE', { signal });
  }

  async getBlob(endpoint: string, signal?: AbortSignal, isRetry = false): Promise<Blob> {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: 'GET',
      headers: this.authHeaders(false),
      signal,
    });

    if (response.status === 401 && !isRetry) {
      const hasRefreshToken = !!this.auth.getRefreshToken();
      if (hasRefreshToken) {
        try {
          await this.refreshTokenIfNeeded();
          return this.getBlob(endpoint, signal, true);
        } catch (error) {
          if (shouldInvalidateSession(error)) {
            this.auth.onSessionExpired();
            throw new Error('Session expired');
          }
          throw error;
        }
      }
    }

    if (!response.ok) {
      const errorMessage = await extractErrorMessage(response);
      throw new Error(errorMessage);
    }

    return response.blob();
  }
}

// Desktop has no VITE_* env (the real backend port is injected at runtime via
// setApiPort); fall back to the local default so the initial URL is well-formed.
let API_BASE_URL: string = resolveHttpBaseUrl(
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8081/api/v1',
);
export let WS_BASE_URL: string = resolveWsBaseUrl(
  import.meta.env.VITE_WS_URL ?? 'ws://localhost:8081/api/v1/ws',
);
// Cloud WS origin, set alongside the cloud HTTP base so sandbox terminals on the
// VPS connect to the right host. Empty until a VPS is connected.
let CLOUD_WS_BASE_URL = '';

export const apiClient = new APIClient(API_BASE_URL, localAuth);

// Second client pointed at the user's remote VPS instance for cloud-run chats.
// The persisted cloud settings hydrate synchronously, so the saved VPS is wired
// up at startup and cloud chats work without re-connecting after a restart.
export const remoteApiClient = new APIClient('', cloudAuth);
const savedCloudUrl = useCloudSettingsStore.getState().cloudUrl;
if (savedCloudUrl) setCloudApiBaseUrl(savedCloudUrl);

// Route a per-chat request to the backend that owns the chat: the cloud VPS if
// the chat was created there, otherwise the local instance.
export function resolveChatClient(chatId: string | undefined): APIClient {
  return chatId && isCloudChat(chatId) ? remoteApiClient : apiClient;
}

// Same routing for per-sandbox calls (files, git, secrets, search).
export function resolveSandboxClient(sandboxId: string | undefined): APIClient {
  return sandboxId && isCloudSandbox(sandboxId) ? remoteApiClient : apiClient;
}

// Terminal WebSockets bypass APIClient, so resolve the base URL + token for the
// backend that owns the sandbox.
export function resolveSandboxWs(sandboxId: string): { baseUrl: string; token: string | null } {
  if (isCloudSandbox(sandboxId)) {
    return { baseUrl: CLOUD_WS_BASE_URL, token: remoteApiClient.getToken() };
  }
  return { baseUrl: WS_BASE_URL, token: apiClient.getToken() };
}

export function setApiPort(port: number): void {
  const origin = `http://127.0.0.1:${port}`;
  API_BASE_URL = `${origin}/api/v1`;
  WS_BASE_URL = `ws://127.0.0.1:${port}/api/v1/ws`;
  apiClient.setBaseUrl(API_BASE_URL);
}

// `url` is the VPS origin (e.g. https://vps.example.com); the API lives under /api/v1.
export function setCloudApiBaseUrl(url: string): void {
  const base = trimTrailingSlash(url);
  remoteApiClient.setBaseUrl(`${base}/api/v1`);
  CLOUD_WS_BASE_URL = resolveWsBaseUrl(`${base}/api/v1/ws`);
}
