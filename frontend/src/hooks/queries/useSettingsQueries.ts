import { useQuery } from '@tanstack/react-query';
import type { QueryClient, UseQueryOptions } from '@tanstack/react-query';
import { settingsService } from '@/services/settingsService';
import type { UserSettings, UserSettingsUpdate } from '@/types/user.types';
import { createMutation } from './createMutation';
import { queryKeys } from './queryKeys';
import { useCloudSettingsQuery } from './useCloudQueries';
import { isCloudChat } from '@/utils/chatOrigin';

const settingsQuery = () => ({
  queryKey: [queryKeys.settings],
  queryFn: () => settingsService.getSettings(),
});

export const useSettingsQuery = (options?: Partial<UseQueryOptions<UserSettings>>) => {
  return useQuery({
    ...settingsQuery(),
    ...options,
  });
};

// Settings are per-instance: a cloud chat's personas and stream actions live on
// the VPS that owns it, not the local backend. Routes to the owning instance the
// same way resolveChatClient routes per-chat API calls. isCloudChat hydrates
// synchronously from localStorage, so deep links resolve before the query fires.
export const useSettingsForChatQuery = (chatId: string | undefined, enabled = true) => {
  const chatIsCloud = !!chatId && isCloudChat(chatId);
  const localQuery = useSettingsQuery({ enabled: enabled && !chatIsCloud });
  const cloudQuery = useCloudSettingsQuery(enabled && chatIsCloud);
  return chatIsCloud ? cloudQuery : localQuery;
};

// Settings are never persisted to storage (they carry secrets), so a cold tab
// must fetch before a saved opt-out can be honored.
export async function fetchNotificationsEnabled(queryClient: QueryClient): Promise<boolean> {
  try {
    const settings = await queryClient.ensureQueryData(settingsQuery());
    return settings.notifications_enabled;
  } catch {
    // Settings unreachable — assume the server default (enabled).
    return true;
  }
}

export const useUpdateSettingsMutation = createMutation<UserSettings, Error, UserSettingsUpdate>(
  (data) => settingsService.updateSettings(data),
  (queryClient, data) => {
    queryClient.setQueryData([queryKeys.settings], data);
  },
);
