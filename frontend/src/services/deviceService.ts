import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth } from '@/services/base/BaseService';
import type { PairedDevice, PairingLink } from '@/types/machine.types';

async function listDevices(): Promise<PairedDevice[]> {
  return withAuth(async () => {
    const response = await apiClient.get<PairedDevice[]>('/auth/devices');
    return ensureResponse(response, 'Failed to load devices');
  });
}

async function revokeDevice(deviceId: string): Promise<void> {
  await withAuth(async () => {
    await apiClient.delete(`/auth/devices/${encodeURIComponent(deviceId)}`);
  });
}

async function createPairingLink(): Promise<PairingLink> {
  return withAuth(async () => {
    const response = await apiClient.post<PairingLink>('/auth/pairing');
    return ensureResponse(response, 'Failed to create a pairing link');
  });
}

export const deviceService = { listDevices, revokeDevice, createPairingLink };
