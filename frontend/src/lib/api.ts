import { authStorage, cloudAuthStorage } from '@/utils/storage';
import { invalidateSessionAndRedirect } from '@/utils/authSession';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import { isCloudChat, isCloudSandbox, clearCloudOrigins } from '@/utils/chatOrigin';
import { NetworkError } from '@/types/errors.types';

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

// Per-client auth store: local vs VPS so tokens don't clobber each other.
interface ClientAuth {
  getToken: () => string | null;
  getRefreshToken: () => string | null;
  setTokens: (accessToken: string, refreshToken: string) => Promise<void>;
  onSessionExpired: () => void;
}

const localAuth: ClientAuth = {
  getToken: () => authStorage.getToken(),
  getRefreshToken: () => authStorage.getRefreshToken(),
  setTokens: (accessToken, refreshToken) => authStorage.setTokens(accessToken, refreshToken),
  onSessionExpired: invalidateSessionAndRedirect,
};

const cloudAuth: ClientAuth = {
  getToken: () => cloudAuthStorage.getAccessToken(),
  getRefreshToken: () => cloudAuthStorage.getRefreshToken(),
  setTokens: (accessToken, refreshToken) => cloudAuthStorage.setTokens(accessToken, refreshToken),
  // Expired VPS refresh can't recover silently — clear cloud so UI shows disconnected.
  onSessionExpired: () => {
    cloudAuthStorage.clear();
    // Match manual disconnect: drop origin IDs so stale routing can't hit a dead VPS.
    clearCloudOrigins();
    useCloudSettingsStore.getState().clearCloud();
  },
};

// Desktop reinstall can leave a stale refresh token after backend identity reset; 401 is terminal.
function shouldInvalidateSession(error: unknown): boolean {
  return error instanceof RefreshTokenError && error.status === 401;
}

const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 30_000;

// Missing/undecodable claims or exp within buffer → don't open long-lived connections on it.
function accessTokenExpiresSoon(token: string): boolean {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
    if (typeof claims.exp !== 'number') return true;
    return claims.exp * 1000 - Date.now() < ACCESS_TOKEN_EXPIRY_BUFFER_MS;
  } catch {
    return true;
  }
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

  // Prefer this over guessing which store pairs with the client (e.g. SSE query param).
  getToken(): string | null {
    return this.auth.getToken();
  }

  // For SSE openers that bypass request(): may need a refresh after restart / dead feed.
  async getValidToken(): Promise<string | null> {
    const cached = this.auth.getToken();
    if (!this.auth.getRefreshToken()) return cached;
    // Don't rotate on every open — churns refresh tokens and can strand clients mid-rotation.
    if (cached && !accessTokenExpiresSoon(cached)) return cached;
    try {
      return (await this.refreshTokenIfNeeded()).access_token;
    } catch (error) {
      // Terminal refresh failure: tear down so SSE reopen loops don't retry forever.
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
    // Await: desktop persist is disk; quit mid-write can leave the rotated-away token.
    await this.auth.setTokens(data.access_token, data.refresh_token);
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

    let response: Response;
    try {
      response = await fetch(`${this.baseURL}${endpoint}`, config);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      throw new NetworkError();
    }

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
      // 401 without refresh → session dead; don't leave UI looking connected.
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

// Desktop has no VITE_* (port via setApiPort); default keeps the initial URL valid.
let API_BASE_URL: string = resolveHttpBaseUrl(
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8081/api/v1',
);
export let WS_BASE_URL: string = resolveWsBaseUrl(
  import.meta.env.VITE_WS_URL ?? 'ws://localhost:8081/api/v1/ws',
);
// VPS WS for cloud sandbox terminals; empty until a VPS is connected.
let CLOUD_WS_BASE_URL = '';

export const apiClient = new APIClient(API_BASE_URL, localAuth);

// Cloud-run client; cloud settings hydrate sync so a saved VPS works after restart.
export const remoteApiClient = new APIClient('', cloudAuth);
const savedCloudUrl = useCloudSettingsStore.getState().cloudUrl;
if (savedCloudUrl) setCloudApiBaseUrl(savedCloudUrl);

// Local vs VPS by chat origin.
export function resolveChatClient(chatId: string | undefined): APIClient {
  return chatId && isCloudChat(chatId) ? remoteApiClient : apiClient;
}

// Local vs VPS by sandbox origin (files, git, search).
export function resolveSandboxClient(sandboxId: string | undefined): APIClient {
  return sandboxId && isCloudSandbox(sandboxId) ? remoteApiClient : apiClient;
}

// Terminals bypass APIClient; mint tokens via getValidToken() (cloud access is memory-only).
export function resolveSandboxWs(sandboxId: string): string {
  return isCloudSandbox(sandboxId) ? CLOUD_WS_BASE_URL : WS_BASE_URL;
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
