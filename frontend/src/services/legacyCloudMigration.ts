import { useMachineStore } from '@/store/machineStore';
import { assignChatsToMachine, assignSandboxesToMachine } from '@/utils/machineOrigin';
import { normalizeHttpsOrigin, routeKindForOrigin } from '@/utils/machineUrl';
import {
  deleteLegacyCloudRefreshToken,
  readLegacyCloudRefreshToken,
  safeGetItem,
  safeRemoveItem,
} from '@/utils/storage';
import { logger } from '@/utils/logger';

export const LEGACY_CLOUD_MACHINE_ID = 'legacy-cloud';

const SETTINGS_KEY = 'cloud-settings-storage';
const CHATS_KEY = 'cloud-chat-ids';
const SANDBOXES_KEY = 'cloud-sandbox-ids';
const LOGOUT_TIMEOUT_MS = 5_000;

function readJson(key: string): unknown {
  try {
    const raw = safeGetItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readLegacyCloudUrl(): string | null {
  const stored = readJson(SETTINGS_KEY) as { state?: { cloudUrl?: unknown } } | null;
  const cloudUrl = stored?.state?.cloudUrl;
  return typeof cloudUrl === 'string' && cloudUrl ? cloudUrl.replace(/\/+$/, '') : null;
}

function readLegacyIds(key: string): string[] {
  const parsed = readJson(key);
  return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
}

async function revokeLegacyRefreshToken(cloudUrl: string, refreshToken: string): Promise<void> {
  try {
    await fetch(`${cloudUrl}/api/v1/auth/jwt/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(LOGOUT_TIMEOUT_MS),
    });
  } catch (error) {
    logger.error('Legacy cloud session revoke failed', 'legacyCloudMigration', error);
  }
}

let migration: Promise<void> | null = null;

export function migrateLegacyCloud(): Promise<void> {
  migration ??= runMigration();
  return migration;
}

async function runMigration(): Promise<void> {
  const hasLegacyState = [SETTINGS_KEY, CHATS_KEY, SANDBOXES_KEY].some(
    (key) => safeGetItem(key) !== null,
  );
  const cloudUrl = readLegacyCloudUrl();
  const origin = cloudUrl ? normalizeHttpsOrigin(cloudUrl) : null;

  if (origin) {
    useMachineStore.getState().addMachine({
      id: LEGACY_CLOUD_MACHINE_ID,
      instanceId: '',
      deviceId: '',
      name: 'Cloud',
      kind: 'server',
      routes: [{ kind: routeKindForOrigin(origin), url: origin }],
      pairedAt: '',
    });
    assignChatsToMachine(LEGACY_CLOUD_MACHINE_ID, readLegacyIds(CHATS_KEY));
    assignSandboxesToMachine(LEGACY_CLOUD_MACHINE_ID, readLegacyIds(SANDBOXES_KEY));
  }

  const refreshToken = await readLegacyCloudRefreshToken();
  if (!hasLegacyState && !refreshToken) return;
  if (refreshToken && cloudUrl) await revokeLegacyRefreshToken(cloudUrl, refreshToken);
  await deleteLegacyCloudRefreshToken();

  safeRemoveItem(CHATS_KEY);
  safeRemoveItem(SANDBOXES_KEY);
  safeRemoveItem(SETTINGS_KEY);
}
