import { invoke } from '@tauri-apps/api/core';
import { isDesktopApp } from '@/utils/platform';
import { jwtExpiryMs } from '@/utils/jwt';
import { normalizeHttpsOrigin } from '@/utils/machineUrl';

export type MachineVaultErrorCode =
  | 'invalid_input'
  | 'invalid_link'
  | 'keychain_unavailable'
  | 'not_paired'
  | 'session_revoked'
  | 'unreachable'
  | 'tls'
  | 'http'
  | 'bad_response'
  | 'internal';

const REQUEST_TIMEOUT_MS = 15_000;
const UNPAIR_TIMEOUT_MS = 5_000;

const memorySessions = new Map<string, { origin: string; refreshToken: string }>();
const memoryLocks = new Map<string, Promise<unknown>>();

export class MachineVaultError extends Error {
  code: MachineVaultErrorCode;

  constructor(code: MachineVaultErrorCode, message: string) {
    super(message);
    this.name = 'MachineVaultError';
    this.code = code;
  }
}

export interface MachineAccessGrant {
  access_token: string;
  expires_at: number;
}

export interface MachinePairResult extends MachineAccessGrant {
  device_id: string;
  instance_id: string;
}

interface MachineVault {
  pair(
    machineId: string,
    url: string,
    secret: string,
    deviceName: string,
  ): Promise<MachinePairResult>;
  refresh(machineId: string): Promise<MachineAccessGrant>;
  unpair(machineId: string, deviceId: string): Promise<{ revoked: boolean }>;
  forget(machineId: string): Promise<void>;
  probe(url: string): Promise<void>;
}

function toVaultError(error: unknown): MachineVaultError {
  if (error instanceof MachineVaultError) return error;
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const { code, message } = error as { code: unknown; message: unknown };
    if (typeof code === 'string' && typeof message === 'string') {
      return new MachineVaultError(code as MachineVaultErrorCode, message);
    }
  }
  return new MachineVaultError('internal', error instanceof Error ? error.message : String(error));
}

async function invokeVault<T>(command: string, args: Record<string, string>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toVaultError(error);
  }
}

const desktopVault: MachineVault = {
  pair: (machineId, url, secret, deviceName) =>
    invokeVault('machine_pair', { machineId, url, secret, deviceName }),
  refresh: (machineId) => invokeVault('machine_refresh', { machineId }),
  unpair: (machineId, deviceId) => invokeVault('machine_unpair', { machineId, deviceId }),
  forget: (machineId) => invokeVault('machine_forget', { machineId }),
  probe: (url) => invokeVault('machine_probe', { url }),
};

function withMachineLock<T>(machineId: string, task: () => Promise<T>): Promise<T> {
  const previous = memoryLocks.get(machineId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  memoryLocks.set(machineId, run);
  void run
    .catch(() => undefined)
    .then(() => {
      if (memoryLocks.get(machineId) === run) memoryLocks.delete(machineId);
    });
  return run;
}

function requireOrigin(url: string): string {
  const origin = normalizeHttpsOrigin(url);
  if (!origin) throw new MachineVaultError('invalid_input', 'Machine URLs must use https');
  return origin;
}

async function send(
  url: string,
  init: { method: string; body?: unknown; bearer?: string },
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: init.method,
      headers: {
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(init.bearer ? { Authorization: `Bearer ${init.bearer}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new MachineVaultError('unreachable', 'The machine could not be reached');
  }
}

function grantFrom(accessToken: unknown): MachineAccessGrant {
  const expiresAt = typeof accessToken === 'string' ? jwtExpiryMs(accessToken) : null;
  if (typeof accessToken !== 'string' || expiresAt === null) {
    throw new MachineVaultError('bad_response', 'The machine returned an unexpected response');
  }
  return { access_token: accessToken, expires_at: Math.floor(expiresAt / 1000) };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new MachineVaultError('bad_response', 'The machine returned an unexpected response');
  }
}

async function rotate(
  origin: string,
  refreshToken: string,
  timeoutMs: number,
): Promise<{ grant: MachineAccessGrant; refreshToken: string }> {
  const response = await send(
    `${origin}/api/v1/auth/jwt/refresh`,
    { method: 'POST', body: { refresh_token: refreshToken } },
    timeoutMs,
  );
  if (response.status === 401) {
    throw new MachineVaultError('session_revoked', "The machine revoked this device's session");
  }
  if (!response.ok) {
    throw new MachineVaultError('http', `The machine responded with HTTP ${response.status}`);
  }
  const body = await readJson(response);
  if (typeof body.refresh_token !== 'string') {
    throw new MachineVaultError('bad_response', 'The machine returned an unexpected response');
  }
  return { grant: grantFrom(body.access_token), refreshToken: body.refresh_token };
}

async function revokeDevice(machineId: string, deviceId: string): Promise<boolean> {
  const session = memorySessions.get(machineId);
  if (!session) return false;
  const { origin } = session;
  let accessToken: string;
  try {
    accessToken = (await rotate(origin, session.refreshToken, UNPAIR_TIMEOUT_MS)).grant
      .access_token;
  } catch (error) {
    return error instanceof MachineVaultError && error.code === 'session_revoked';
  }
  try {
    const response = await send(
      `${origin}/api/v1/auth/devices/${encodeURIComponent(deviceId)}`,
      { method: 'DELETE', bearer: accessToken },
      UNPAIR_TIMEOUT_MS,
    );
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

const browserVault: MachineVault = {
  pair: (machineId, url, secret, deviceName) =>
    withMachineLock(machineId, async () => {
      const origin = requireOrigin(url);
      const response = await send(
        `${origin}/api/v1/auth/pair`,
        { method: 'POST', body: { secret, device_name: deviceName } },
        REQUEST_TIMEOUT_MS,
      );
      if (response.status === 400) {
        throw new MachineVaultError('invalid_link', 'Invalid or expired pairing link');
      }
      if (!response.ok) {
        throw new MachineVaultError('http', `The machine responded with HTTP ${response.status}`);
      }
      const body = await readJson(response);
      if (
        typeof body.refresh_token !== 'string' ||
        typeof body.device_id !== 'string' ||
        typeof body.instance_id !== 'string'
      ) {
        throw new MachineVaultError('bad_response', 'The machine returned an unexpected response');
      }
      const grant = grantFrom(body.access_token);
      memorySessions.set(machineId, { origin, refreshToken: body.refresh_token });
      return { ...grant, device_id: body.device_id, instance_id: body.instance_id };
    }),
  refresh: (machineId) =>
    withMachineLock(machineId, async () => {
      const session = memorySessions.get(machineId);
      if (!session) {
        throw new MachineVaultError('not_paired', 'This machine is not paired on this device');
      }
      try {
        const rotated = await rotate(session.origin, session.refreshToken, REQUEST_TIMEOUT_MS);
        memorySessions.set(machineId, { ...session, refreshToken: rotated.refreshToken });
        return rotated.grant;
      } catch (error) {
        if (error instanceof MachineVaultError && error.code === 'session_revoked') {
          memorySessions.delete(machineId);
        }
        throw error;
      }
    }),
  unpair: (machineId, deviceId) =>
    withMachineLock(machineId, async () => {
      const revoked = await revokeDevice(machineId, deviceId);
      memorySessions.delete(machineId);
      return { revoked };
    }),
  forget: (machineId) =>
    withMachineLock(machineId, async () => {
      memorySessions.delete(machineId);
    }),
  probe: async (url) => {
    const origin = requireOrigin(url);
    try {
      await fetch(`${origin}/health`, {
        mode: 'no-cors',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(UNPAIR_TIMEOUT_MS),
      });
    } catch {
      throw new MachineVaultError('unreachable', 'The machine could not be reached');
    }
  },
};

export const machineVault: MachineVault = isDesktopApp() ? desktopVault : browserVault;
