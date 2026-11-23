import { useQuery } from '@tanstack/react-query';
import type { QueryClient, UseQueryOptions } from '@tanstack/react-query';
import { settingsService } from '@/services/settingsService';
import type { UserSettings, UserSettingsUpdate } from '@/types/user.types';
import { createMutation } from './createMutation';
import { retryTransientOnce } from './listLoad';
import { queryKeys } from './queryKeys';
import { machineSettingsQuery, useMachineSettingsQuery } from './useMachineQueries';
import { useChatMachineId } from '@/store/machineOrigin';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';

const settingsQuery = () => ({
  queryKey: [queryKeys.settings],
  queryFn: () => settingsService.getSettings(LOCAL_MACHINE_ID),
  retry: retryTransientOnce,
});

export const useSettingsQuery = (options?: Partial<UseQueryOptions<UserSettings>>) => {
  return useQuery({
    ...settingsQuery(),
    ...options,
  });
};

// Settings are per-instance: a remote chat's personas and stream actions live on
// the machine that owns it. Routes the same way resolveChatClient routes per-chat
// calls; origins hydrate synchronously, so deep links resolve before the query fires.
export const useSettingsForChatQuery = (chatId: string | undefined, enabled = true) => {
  return useSettingsForMachineQuery(useChatMachineId(chatId), enabled);
};

export const useSettingsForMachineQuery = (machineId: string, enabled = true) => {
  const isLocal = machineId === LOCAL_MACHINE_ID;
  const localQuery = useSettingsQuery({ enabled: enabled && isLocal });
  const machineQuery = useMachineSettingsQuery(machineId, enabled && !isLocal);
  return isLocal ? localQuery : machineQuery;
};

// Settings are never persisted to storage (they carry secrets), so a cold tab
// must fetch before a saved opt-out can be honored.
export async function fetchNotificationSettings(
  queryClient: QueryClient,
): Promise<UserSettings | null> {
  try {
    return await queryClient.ensureQueryData(settingsQuery());
  } catch {
    // Settings unreachable — callers assume the server defaults (all enabled).
    return null;
  }
}

export async function fetchAutoSteerQueuedMessages(
  queryClient: QueryClient,
  machineId: string,
): Promise<boolean> {
  try {
    const settings =
      machineId === LOCAL_MACHINE_ID
        ? await queryClient.ensureQueryData(settingsQuery())
        : await queryClient.ensureQueryData(machineSettingsQuery(machineId));
    return settings.auto_steer_queued_messages;
  } catch {
    return false;
  }
}

export const useUpdateSettingsMutation = createMutation<UserSettings, Error, UserSettingsUpdate>(
  (data) => settingsService.updateSettings(LOCAL_MACHINE_ID, data),
  (queryClient, data) => {
    queryClient.setQueryData([queryKeys.settings], data);
  },
);
