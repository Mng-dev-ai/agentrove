import { apiClient } from '@/lib/api';
import { logger } from '@/utils/logger';
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/utils/storage';

// Persisted so a logout on a later launch, before this launch re-registers, can still
// remove the device. The backend only deletes it for the signed-in owner.
const PUSH_TOKEN_KEY = 'push-device-token';

let registration: Promise<void> = Promise.resolve();
let registeredToken: string | null = null;

export function isPushRegistered(): boolean {
  return registeredToken !== null;
}

export function registerPushDevice(token: string, sandbox: boolean): Promise<void> {
  safeSetItem(PUSH_TOKEN_KEY, token);
  const pending = apiClient.post('/push/devices', { token, sandbox }).then(() => {
    registeredToken = token;
  });
  registration = pending.catch(() => undefined);
  return pending;
}

// Call while the access token is still valid. Waits out an in-flight registration
// so it can't land after logout. Failure must not block logout; re-registering
// under another account moves the device server-side anyway.
export async function unregisterPushDevice(): Promise<void> {
  await registration;
  registeredToken = null;
  const token = safeGetItem(PUSH_TOKEN_KEY);
  if (!token) return;
  try {
    await apiClient.delete(`/push/devices/${token}`);
    safeRemoveItem(PUSH_TOKEN_KEY);
  } catch (error) {
    logger.warn('Push device unregister failed', 'push', error);
  }
}
