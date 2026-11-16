import { apiClient } from '@/lib/api';
import { ensureResponse, withAuth } from '@/services/base/BaseService';
import { ValidationError } from '@/services/base/ServiceError';
import type { UserSettings, UserSettingsUpdate } from '@/types/user.types';

async function getSettings(): Promise<UserSettings> {
  return withAuth(
    async () => {
      const response = await apiClient.get<UserSettings>('/settings/');
      return ensureResponse(response, 'Failed to fetch user settings');
    },
    { maxRetries: 1 },
  );
}

async function updateSettings(data: UserSettingsUpdate): Promise<UserSettings> {
  if (!data || Object.keys(data).length === 0) {
    throw new ValidationError('Settings update data is required');
  }

  return withAuth(async () => {
    const response = await apiClient.patch<UserSettings>('/settings/', data);
    return ensureResponse(response, 'Failed to update user settings');
  });
}

export const settingsService = {
  getSettings,
  updateSettings,
};
