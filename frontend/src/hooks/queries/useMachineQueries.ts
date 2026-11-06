import { useCallback } from 'react';
import { useQuery, useQueries, keepPreviousData, type UseQueryResult } from '@tanstack/react-query';
import { machineChatService } from '@/services/machineChatService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
import { useMachineStatus, useMachineStore } from '@/store/machineStore';
import type {
  Workspace,
  WorkspaceResources,
  UpdateWorkspaceRequest,
} from '@/types/workspace.types';
import type { UserSettings } from '@/types/user.types';
import type { ActiveStreamSnapshot } from '@/types/stream.types';
import type { ChatSearchResponse } from '@/types/chat.types';

export const useMachineOnline = (machineId: string) => useMachineStatus(machineId) === 'online';

export const useMachineWorkspacesQuery = (machineId: string, enabled: boolean) => {
  const online = useMachineOnline(machineId);
  return useQuery<Workspace[]>({
    queryKey: queryKeys.machine.workspaces(machineId),
    queryFn: () => machineChatService.listWorkspaces(machineId),
    enabled: enabled && online,
    staleTime: 30_000,
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
      queryKey: queryKeys.machine.workspaces(machineId),
      queryFn: () => machineChatService.listWorkspaces(machineId),
      enabled: enabled && connections[machineId]?.status === 'online',
      staleTime: 30_000,
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
    machineChatService.updateWorkspace(machineId, workspaceId, data),
  (queryClient, _data, { machineId }) =>
    queryClient.invalidateQueries({ queryKey: queryKeys.machine.workspaces(machineId) }),
);

export const useMachineDeleteWorkspaceMutation = createMutation<
  void,
  Error,
  { machineId: string; workspaceId: string }
>(
  ({ machineId, workspaceId }) => machineChatService.deleteWorkspace(machineId, workspaceId),
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
    queryFn: () => machineChatService.getWorkspaceResources(machineId, workspaceId!),
    enabled: enabled && online && !!workspaceId,
    staleTime: 30_000,
  });
};

export const useMachineSettingsQuery = (machineId: string, enabled: boolean) => {
  const online = useMachineOnline(machineId);
  return useQuery<UserSettings>({
    queryKey: queryKeys.machine.settings(machineId),
    queryFn: () => machineChatService.getSettings(machineId),
    enabled: enabled && online,
    staleTime: 30_000,
  });
};

export const useMachineActiveStreamsQuery = (machineId: string, enabled: boolean) => {
  const online = useMachineOnline(machineId);
  return useQuery<ActiveStreamSnapshot[]>({
    queryKey: queryKeys.machine.activeStreams(machineId),
    queryFn: () => machineChatService.getActiveStreams(machineId),
    enabled: enabled && online,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
};

export const useMachineChatsTotalQuery = (machineId: string, enabled: boolean) => {
  const online = useMachineOnline(machineId);
  return useQuery({
    queryKey: [...queryKeys.machine.chats(machineId), 'total'] as const,
    queryFn: () => machineChatService.listChats(machineId, { page: 1, per_page: 1 }),
    select: (data) => data.total,
    enabled: enabled && online,
    staleTime: 30_000,
  });
};

export const useSearchMachineChatsQueries = (machineIds: string[], query: string) => {
  const trimmed = query.trim();
  return useQueries({
    queries: machineIds.map((machineId) => ({
      queryKey: [...queryKeys.machine.chats(machineId), 'search', trimmed] as const,
      queryFn: (): Promise<ChatSearchResponse> =>
        machineChatService.searchChats(machineId, trimmed),
      enabled: trimmed.length >= 2,
      placeholderData: keepPreviousData,
      staleTime: 15_000,
    })),
  });
};
