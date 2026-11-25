import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueries, type UseQueryResult } from '@tanstack/react-query';
import { chatService } from '@/services/chatService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { listLoadState } from '@/hooks/queries/listLoad';
import { settingsQuery } from '@/hooks/queries/useSettingsQueries';
import { workspacesQuery } from '@/hooks/queries/useWorkspaceQueries';
import { useMachineFilter } from '@/hooks/useMachineFilter';
import { useSettingsContext } from '@/hooks/useSettingsContext';
import {
  LOCAL_MACHINE_NAME,
  useMachineOnline,
  useMachineStore,
  useOnlineRemoteMachineIds,
} from '@/store/machineStore';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { Workspace } from '@/types/workspace.types';
import type { UserSettings } from '@/types/user.types';
import type { ActiveStreamSnapshot } from '@/types/stream.types';
import type { ChatSearchResponse } from '@/types/chat.types';

type SettingsListKey = 'personas' | 'custom_env_vars' | 'stream_actions';
type SettingsListEntry<K extends SettingsListKey> = NonNullable<UserSettings[K]>[number];

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
      ...workspacesQuery(machineId),
      enabled: enabled && connections[machineId]?.status === 'online',
    })),
    combine,
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
  const localEntries: SettingsListEntry<K>[] | null = localSettings[key];
  const combine = useCallback(
    (results: UseQueryResult<UserSettings>[]) => {
      const shown = remoteIds
        .map((id, index) => ({ id, result: results[index] }))
        .filter(({ id }) => !machineId || id === machineId);
      const load = listLoadState(shown.map(({ result }) => result));
      if (shown.some(({ result }) => result.isLoading)) return { items: null, load };
      const local = !machineId || machineId === LOCAL_MACHINE_ID ? (localEntries ?? []) : [];
      return {
        items: [
          ...local.map((entry) => ({ entry, machineId: LOCAL_MACHINE_ID })),
          ...shown.flatMap(({ id, result }) => {
            const entries: SettingsListEntry<K>[] = result.data?.[key] ?? [];
            return entries.map((entry) => ({ entry, machineId: id }));
          }),
        ],
        load,
      };
    },
    [remoteIds, key, machineId, localEntries],
  );
  const { items, load } = useQueries({ queries: remoteIds.map(settingsQuery), combine });
  const machineName = (id: string) => machineNames.get(id) ?? 'Machine';
  return { machineOptions, machineName, machineId, filter, items, load };
};

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
      queryKey: queryKeys.machine.chatsSearch(machineId, trimmed),
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
