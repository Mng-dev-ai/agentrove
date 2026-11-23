import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueries, type UseQueryResult } from '@tanstack/react-query';
import { chatService } from '@/services/chatService';
import { settingsService } from '@/services/settingsService';
import { workspaceService } from '@/services/workspaceService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
import { listLoadState, retryTransientOnce } from '@/hooks/queries/listLoad';
import { useMachineFilter } from '@/hooks/useMachineFilter';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import {
  LOCAL_MACHINE_NAME,
  useMachineStatus,
  useMachineStore,
  useOnlineRemoteMachineIds,
} from '@/store/machineStore';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type {
  Workspace,
  WorkspaceResources,
  UpdateWorkspaceRequest,
} from '@/types/workspace.types';
import type { UserSettings, UserSettingsUpdate } from '@/types/user.types';
import type { ActiveStreamSnapshot } from '@/types/stream.types';
import { writeVersionedSettings } from '@/utils/settings';
import type { ChatSearchResponse } from '@/types/chat.types';

type SettingsListKey = 'personas' | 'custom_env_vars' | 'stream_actions';
type SettingsListEntry<K extends SettingsListKey> = NonNullable<UserSettings[K]>[number];

export const useMachineOnline = (machineId: string) => useMachineStatus(machineId) === 'online';

const machineWorkspacesQuery = (machineId: string) => ({
  queryKey: queryKeys.machine.workspaces(machineId),
  queryFn: async () => (await workspaceService.listWorkspaces(machineId)).items,
  staleTime: 30_000,
});

export const useMachineWorkspacesQuery = (machineId: string, enabled: boolean) => {
  const online = useMachineOnline(machineId);
  return useQuery<Workspace[]>({
    ...machineWorkspacesQuery(machineId),
    enabled: enabled && online,
  });
};

export const useMachinesWorkspaces = (machineIds: string[], enabled: boolean) => {
  const connections = useMachineStore((state) => state.connections);
  const combine = useCallback(
    (results: UseQueryResult<Workspace[]>[]): Record<string, Workspace[]> =>
      Object.fromEntries(
        machineIds.map((machineId, index) => [machineId, results[index]?.data ?? []]),
      ),
    [machineIds],
  );
  return useQueries({
    queries: machineIds.map((machineId) => ({
      ...machineWorkspacesQuery(machineId),
      enabled: enabled && connections[machineId]?.status === 'online',
    })),
    combine,
  });
};

export const useMachineUpdateWorkspaceMutation = createMutation<
  Workspace,
  Error,
  { machineId: string; workspaceId: string; data: UpdateWorkspaceRequest }
>(
  ({ machineId, workspaceId, data }) =>
    workspaceService.updateWorkspace(machineId, workspaceId, data),
  (queryClient, _data, { machineId }) =>
    queryClient.invalidateQueries({ queryKey: queryKeys.machine.workspaces(machineId) }),
);

export const useMachineDeleteWorkspaceMutation = createMutation<
  void,
  Error,
  { machineId: string; workspaceId: string }
>(
  ({ machineId, workspaceId }) => workspaceService.deleteWorkspace(machineId, workspaceId),
  async (queryClient, _data, { machineId }) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.machine.workspaces(machineId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.machine.chats(machineId) }),
    ]);
  },
);

export const useMachineWorkspaceResourcesQuery = (
  machineId: string,
  workspaceId: string | undefined,
  enabled: boolean,
) => {
  const online = useMachineOnline(machineId);
  return useQuery<WorkspaceResources>({
    queryKey: queryKeys.machine.workspaceResources(machineId, workspaceId),
    queryFn: () => workspaceService.getWorkspaceResources(machineId, workspaceId!),
    enabled: enabled && online && !!workspaceId,
    staleTime: 30_000,
  });
};

export const machineSettingsQuery = (machineId: string) => ({
  queryKey: queryKeys.machine.settings(machineId),
  queryFn: () => settingsService.getSettings(machineId),
  staleTime: 30_000,
  retry: retryTransientOnce,
});

export const useMachineSettingsQuery = (machineId: string, enabled: boolean) => {
  const online = useMachineOnline(machineId);
  return useQuery<UserSettings>({
    ...machineSettingsQuery(machineId),
    enabled: enabled && online,
  });
};

export interface MachineSettingsItem<T> {
  entry: T;
  machineId: string;
}

export const useMachinesSettingsList = <K extends SettingsListKey>(key: K, emptyText: string) => {
  const { localSettings } = useSettingsContext();
  const remoteIds = useOnlineRemoteMachineIds();
  const machines = useMachineStore((state) => state.machines);
  const machineNames = useMemo(
    () => new Map(machines.map((machine) => [machine.id, machine.name])),
    [machines],
  );
  const machineOptions = useMemo(
    () => [
      { id: LOCAL_MACHINE_ID, name: LOCAL_MACHINE_NAME },
      ...remoteIds.map((id) => ({ id, name: machineNames.get(id) ?? 'Machine' })),
    ],
    [remoteIds, machineNames],
  );
  const { machineId, filter } = useMachineFilter(machineOptions, emptyText);
  const combine = useCallback(
    (results: UseQueryResult<UserSettings>[]) => {
      const byMachine: Record<string, SettingsListEntry<K>[]> = Object.fromEntries(
        remoteIds.map((id, index) => [id, results[index]?.data?.[key] ?? []]),
      );
      const shown = results.filter(
        (_result, index) => !machineId || remoteIds[index] === machineId,
      );
      return {
        byMachine,
        isLoading: shown.some((result) => result.isLoading),
        load: listLoadState(shown),
      };
    },
    [remoteIds, key, machineId],
  );
  const remote = useQueries({ queries: remoteIds.map(machineSettingsQuery), combine });
  const localEntries: SettingsListEntry<K>[] | null = localSettings[key];
  const items = useMemo((): MachineSettingsItem<SettingsListEntry<K>>[] | null => {
    if (remote.isLoading) return null;
    const byMachine: Record<string, SettingsListEntry<K>[]> = {
      ...remote.byMachine,
      [LOCAL_MACHINE_ID]: localEntries ?? [],
    };
    return machineOptions
      .filter((machine) => !machineId || machine.id === machineId)
      .flatMap((machine) =>
        (byMachine[machine.id] ?? []).map((entry) => ({ entry, machineId: machine.id })),
      );
  }, [remote.isLoading, remote.byMachine, localEntries, machineOptions, machineId]);
  const machineName = (id: string) => machineNames.get(id) ?? 'Machine';
  return { machineOptions, machineName, machineId, filter, items, load: remote.load };
};

export const useUpdateMachineSettingsMutation = createMutation<
  UserSettings,
  Error,
  { machineId: string; update: (settings: UserSettings) => UserSettingsUpdate }
>(
  async ({ machineId, update }) =>
    writeVersionedSettings(
      await settingsService.getSettings(machineId),
      () => settingsService.getSettings(machineId),
      update,
      (data) => settingsService.updateSettings(machineId, data),
    ),
  (queryClient, data, { machineId }) => {
    queryClient.setQueryData(queryKeys.machine.settings(machineId), data);
  },
);

export const useMachineActiveStreamsQuery = (machineId: string, enabled: boolean) => {
  const online = useMachineOnline(machineId);
  return useQuery<ActiveStreamSnapshot[]>({
    queryKey: queryKeys.machine.activeStreams(machineId),
    queryFn: () => chatService.getActiveStreams(machineId),
    enabled: enabled && online,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
};

export const useMachineChatsTotalQuery = (machineId: string, enabled: boolean) => {
  const online = useMachineOnline(machineId);
  return useQuery({
    queryKey: [...queryKeys.machine.chats(machineId), 'total'] as const,
    queryFn: () => chatService.listChats(machineId, { page: 1, per_page: 1 }),
    select: (data) => data.total,
    enabled: enabled && online,
    staleTime: 30_000,
  });
};

export const useSearchMachineChatsQueries = (machineIds: string[], query: string) => {
  const trimmed = query.trim();
  const lastData = useRef<Record<string, ChatSearchResponse>>({});
  const results = useQueries({
    queries: machineIds.map((machineId) => ({
      queryKey: [...queryKeys.machine.chats(machineId), 'search', trimmed] as const,
      queryFn: (): Promise<ChatSearchResponse> => chatService.searchChats(machineId, trimmed),
      enabled: trimmed.length >= 2,
      placeholderData: () => lastData.current[machineId],
      staleTime: 15_000,
    })),
  });
  useEffect(() => {
    results.forEach((result, index) => {
      if (result.data && !result.isPlaceholderData) {
        lastData.current[machineIds[index]] = result.data;
      }
    });
  });
  return results;
};
