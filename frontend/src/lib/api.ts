import { authStorage } from '@/utils/storage';
import { invalidateSessionAndRedirect } from '@/utils/authSession';
import { chatMachineId, sandboxMachineId } from '@/utils/machineOrigin';
import { jwtExpiryMs } from '@/utils/jwt';
import { NetworkError } from '@/types/errors.types';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import {
  getMachineAccessToken,
  markMachineSessionRevoked,
  onlineRouteUrl,
  refreshMachineAccess,
} from '@/services/machineSession';
import { MachineVaultError } from '@/services/machineVault';

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

const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

const resolveHttpBaseUrl = (rawUrl: string): string =>
  trimTrailingSlash(new URL(rawUrl, window.location.origin).toString());

const resolveWsBaseUrl = (rawUrl: string): string => {
  const normalized = new URL(rawUrl, window.location.origin);
  normalized.protocol = ['https:', 'wss:'].includes(normalized.protocol) ? 'wss:' : 'ws:';
  return trimTrailingSlash(normalized.toString());
};

interface ClientAuth {
  getToken: () => string | null;
  canRefresh: () => boolean;
  refresh: (baseUrl: string) => Promise<string>;
  onSessionExpired: () => void;
}

// Desktop reinstall can leave a stale refresh token after backend identity reset; 401 is terminal.
function shouldInvalidateSession(error: unknown): boolean {
  return error instanceof RefreshTokenError && error.status === 401;
}

const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 30_000;

// Missing/undecodable claims or exp within buffer → don't open long-lived connections on it.
function accessTokenExpiresSoon(token: string): boolean {
  const expiresAt = jwtExpiryMs(token);
  return expiresAt === null || expiresAt - Date.now() < ACCESS_TOKEN_EXPIRY_BUFFER_MS;
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

async function refreshLocalSession(baseUrl: string): Promise<string> {
  const refreshToken = authStorage.getRefreshToken();
  if (!refreshToken) {
    throw new RefreshTokenError(401, 'No refresh token available');
  }

  const response = await fetch(`${baseUrl}/auth/jwt/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  }).catch(() => {
    throw new RefreshTokenError(0);
  });

  const data: TokenResponse | null = response.ok ? await response.json() : null;

  const currentRefreshToken = authStorage.getRefreshToken();
  if (currentRefreshToken !== refreshToken) {
    if (!currentRefreshToken) {
      throw new RefreshTokenError(401, 'No refresh token available');
    }
    const currentToken = authStorage.getToken();
    if (!currentToken || accessTokenExpiresSoon(currentToken)) {
      throw new RefreshTokenError(0);
    }
    return currentToken;
  }

  if (!data) {
    throw new RefreshTokenError(response.status);
  }
  // Await: desktop persist is disk; quit mid-write can leave the rotated-away token.
  await authStorage.setTokens(data.access_token, data.refresh_token);
  return data.access_token;
}

class APIClient {
  private resolveBaseUrl: () => string;
  private auth: ClientAuth;
  private refreshingPromise: Promise<string> | null = null;

  constructor(resolveBaseUrl: () => string, auth: ClientAuth) {
    this.resolveBaseUrl = resolveBaseUrl;
    this.auth = auth;
  }

  getBaseUrl(): string {
    return this.resolveBaseUrl();
  }

  // Prefer this over guessing which store pairs with the client (e.g. SSE query param).
  getToken(): string | null {
    return this.auth.getToken();
  }

  // For SSE openers that bypass request(): may need a refresh after restart / dead feed.
  async getValidToken(): Promise<string | null> {
    const cached = this.auth.getToken();
    if (!this.auth.canRefresh()) return cached;
    // Don't rotate on every open — churns refresh tokens and can strand clients mid-rotation.
    if (cached && !accessTokenExpiresSoon(cached)) return cached;
    try {
      return await this.refreshTokenIfNeeded();
    } catch (error) {
      // Terminal refresh failure: tear down so SSE reopen loops don't retry forever.
      if (shouldInvalidateSession(error)) {
        this.auth.onSessionExpired();
        return null;
      }
      throw error;
    }
  }

  private authHeaders(includeContentType = true): Record<string, string> {
    const token = this.auth.getToken();
    return {
      ...(includeContentType ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  private async refreshTokenIfNeeded(): Promise<string> {
    if (this.refreshingPromise) {
      return this.refreshingPromise;
    }

    this.refreshingPromise = this.auth.refresh(this.resolveBaseUrl());

    try {
      return await this.refreshingPromise;
    } finally {
      this.refreshingPromise = null;
    }
  }

  private async recoverFromUnauthorized(): Promise<boolean> {
    if (!this.auth.canRefresh()) {
      this.auth.onSessionExpired();
      return false;
    }
    try {
      await this.refreshTokenIfNeeded();
      return true;
    } catch (error) {
      if (!shouldInvalidateSession(error)) throw error;
      this.auth.onSessionExpired();
      return false;
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
      response = await fetch(`${this.resolveBaseUrl()}${endpoint}`, config);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      throw new NetworkError();
    }

    if (response.status === 401 && !isRetry && !endpoint.includes('/auth/jwt/')) {
      if (await this.recoverFromUnauthorized()) {
        return this.request<T>(endpoint, method, options, additionalHeaders, true);
      }
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
    const response = await fetch(`${this.resolveBaseUrl()}${endpoint}`, {
      method: 'GET',
      headers: this.authHeaders(false),
      signal,
    });

    if (response.status === 401 && !isRetry) {
      if (this.auth.canRefresh()) {
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

  async openStream(endpoint: string, signal: AbortSignal, isRetry = false): Promise<Response> {
    const response = await fetch(`${this.resolveBaseUrl()}${endpoint}`, {
      method: 'GET',
      headers: { ...this.authHeaders(false), Accept: 'text/event-stream' },
      cache: 'no-store',
      signal,
    });

    if (response.status === 401 && !isRetry && (await this.recoverFromUnauthorized())) {
      return this.openStream(endpoint, signal, true);
    }

    return response;
  }
}

// Desktop has no VITE_* (port via setApiPort); default keeps the initial URL valid.
let API_BASE_URL: string = resolveHttpBaseUrl(
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8081/api/v1',
);
export let WS_BASE_URL: string = resolveWsBaseUrl(
  import.meta.env.VITE_WS_URL ?? 'ws://localhost:8081/api/v1/ws',
);

const localAuth: ClientAuth = {
  getToken: () => authStorage.getToken(),
  canRefresh: () => !!authStorage.getRefreshToken(),
  refresh: refreshLocalSession,
  onSessionExpired: invalidateSessionAndRedirect,
};

export const apiClient = new APIClient(() => API_BASE_URL, localAuth);

function machineAuth(machineId: string): ClientAuth {
  return {
    getToken: () => getMachineAccessToken(machineId),
    canRefresh: () => true,
    refresh: async () => {
      try {
        return await refreshMachineAccess(machineId);
      } catch (error) {
        const sessionLost =
          error instanceof MachineVaultError &&
          (error.code === 'session_revoked' || error.code === 'not_paired');
        throw new RefreshTokenError(sessionLost ? 401 : 0);
      }
    },
    onSessionExpired: () => markMachineSessionRevoked(machineId),
  };
}

const machineClients = new Map<string, APIClient>();

export function getMachineClient(machineId: string): APIClient {
  if (machineId === LOCAL_MACHINE_ID) return apiClient;
  let client = machineClients.get(machineId);
  if (!client) {
    client = new APIClient(() => `${onlineRouteUrl(machineId)}/api/v1`, machineAuth(machineId));
    machineClients.set(machineId, client);
  }
  return client;
}

export function disposeMachineClient(machineId: string): void {
  machineClients.delete(machineId);
}

function getMachineWsBaseUrl(machineId: string): string {
  if (machineId === LOCAL_MACHINE_ID) return WS_BASE_URL;
  return resolveWsBaseUrl(`${onlineRouteUrl(machineId)}/api/v1/ws`);
}

export function resolveChatClient(chatId: string | undefined): APIClient {
  return getMachineClient(chatMachineId(chatId));
}

export function resolveSandboxClient(sandboxId: string | undefined): APIClient {
  return getMachineClient(sandboxMachineId(sandboxId));
}

export function resolveSandboxWs(sandboxId: string): string {
  return getMachineWsBaseUrl(sandboxMachineId(sandboxId));
}

export function setApiPort(port: number): void {
  const origin = `http://127.0.0.1:${port}`;
  API_BASE_URL = `${origin}/api/v1`;
  WS_BASE_URL = `ws://127.0.0.1:${port}/api/v1/ws`;
}

