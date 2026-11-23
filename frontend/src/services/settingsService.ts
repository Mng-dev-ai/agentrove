import { getMachineClient } from '@/lib/api';
import { ensureResponse, withMachineAuth } from '@/services/base/BaseService';
import { ValidationError } from '@/services/base/ServiceError';
import type { UserSettings, UserSettingsUpdate } from '@/types/user.types';

async function getSettings(machineId: string): Promise<UserSettings> {
  return withMachineAuth(
    machineId,
    async () => {
      const response = await getMachineClient(machineId).get<UserSettings>('/settings/');
      return ensureResponse(response, 'Failed to fetch user settings');
    },
    { maxRetries: 1 },
  );
}

async function updateSettings(machineId: string, data: UserSettingsUpdate): Promise<UserSettings> {
  if (!data || Object.keys(data).length === 0) {
    throw new ValidationError('Settings update data is required');
  }

  return withMachineAuth(
    machineId,
    async () => {
      const response = await getMachineClient(machineId).patch<UserSettings>('/settings/', data);
      return ensureResponse(response, 'Failed to update user settings');
    },
    { maxRetries: 0 },
  );
}

export const settingsService = {
  getSettings,
  updateSettings,
};
