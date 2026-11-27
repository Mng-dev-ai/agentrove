import { useQuery } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { settingsService } from '@/services/settingsService';
import type { UserSettings, UserSettingsUpdate } from '@/types/user.types';
import { createMutation } from './createMutation';
import { retryTransientOnce } from './listLoad';
import { queryKeys } from './queryKeys';
import { useChatMachineId } from '@/store/machineOrigin';
import { useMachineOnline } from '@/store/machineStore';
import { LOCAL_MACHINE_ID, type MachineQueryOptions } from '@/types/machine.types';
import { writeVersionedSettings } from '@/utils/settings';

type SettingsWrite =
  | { data: UserSettingsUpdate }
  | { update: (settings: UserSettings) => UserSettingsUpdate; read?: UserSettings };

export const settingsQuery = (machineId: string) => ({
  queryKey: queryKeys.machine.settings(machineId),
  queryFn: () => settingsService.getSettings(machineId),
  staleTime: 30_000,
  retry: retryTransientOnce,
});

// Settings are per-instance: a remote chat's personas and stream actions live on
// the machine that owns it.
export const useSettingsQuery = (options?: MachineQueryOptions) => {
  const machineId = options?.machineId ?? LOCAL_MACHINE_ID;
  const online = useMachineOnline(machineId);
  return useQuery({
    ...settingsQuery(machineId),
    enabled: (options?.enabled ?? true) && online,
  });
};

// Routes the same way resolveChatClient routes per-chat calls; origins hydrate
// synchronously, so deep links resolve before the query fires.
export const useSettingsForChatQuery = (chatId: string | undefined, enabled = true) => {
  return useSettingsQuery({ machineId: useChatMachineId(chatId), enabled });
};

// Settings are never persisted to storage (they carry secrets), so a cold tab
// must fetch before a saved opt-out can be honored.
export async function fetchNotificationSettings(
  queryClient: QueryClient,
): Promise<UserSettings | null> {
  try {
    return await queryClient.ensureQueryData(settingsQuery(LOCAL_MACHINE_ID));
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
    const settings = await queryClient.ensureQueryData(settingsQuery(machineId));
    return settings.auto_steer_queued_messages;
  } catch {
    return false;
  }
}

export const useUpdateSettingsMutation = createMutation<
  UserSettings,
  Error,
  { machineId: string } & SettingsWrite
>(
  async ({ machineId, ...write }) =>
    'data' in write
      ? settingsService.updateSettings(machineId, write.data)
      : writeVersionedSettings(
          write.read ?? (await settingsService.getSettings(machineId)),
          () => settingsService.getSettings(machineId),
          write.update,
          (data) => settingsService.updateSettings(machineId, data),
        ),
  (queryClient, data, { machineId }) => {
    queryClient.setQueryData(settingsQuery(machineId).queryKey, data);
  },
);
