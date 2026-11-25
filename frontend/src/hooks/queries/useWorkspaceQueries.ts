import { useQuery } from '@tanstack/react-query';
import { workspaceService } from '@/services/workspaceService';
import type {
  Workspace,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
} from '@/types/workspace.types';
import type { PaginatedResponse } from '@/types/api.types';
import type { Chat } from '@/types/chat.types';
import type { Channel } from '@/types/channel.types';
import { useChannelStore } from '@/store/channelStore';
import { useMachineOnline } from '@/store/machineStore';
import { LOCAL_MACHINE_ID, type MachineQueryOptions } from '@/types/machine.types';
import { createMutation } from './createMutation';
import { queryKeys } from './queryKeys';

const EMPTY_WORKSPACES: Workspace[] = [];

const workspacesKey = (machineId: string) =>
  machineId === LOCAL_MACHINE_ID ? queryKeys.workspaces : queryKeys.machine.workspaces(machineId);

const selectWorkspaces = (data: PaginatedResponse<Workspace>) => data.items;

export const workspacesQuery = (machineId: string) => ({
  queryKey: workspacesKey(machineId),
  queryFn: () => workspaceService.listWorkspaces(machineId),
  select: selectWorkspaces,
  staleTime: 30_000,
});

export const useWorkspacesQuery = (options?: MachineQueryOptions) => {
  const machineId = options?.machineId ?? LOCAL_MACHINE_ID;
  const online = useMachineOnline(machineId);
  return useQuery({
    ...workspacesQuery(machineId),
    enabled: (options?.enabled ?? true) && online,
  });
};

export const useWorkspacesList = (options?: MachineQueryOptions): Workspace[] =>
  useWorkspacesQuery(options).data ?? EMPTY_WORKSPACES;

export const useWorkspaceResourcesQuery = (
  machineId: string,
  workspaceId: string | undefined,
  enabled = true,
) => {
  const online = useMachineOnline(machineId);
  return useQuery({
    queryKey:
      machineId === LOCAL_MACHINE_ID
        ? queryKeys.workspaceResources(workspaceId)
        : queryKeys.machine.workspaceResources(machineId, workspaceId),
    queryFn: () => workspaceService.getWorkspaceResources(machineId, workspaceId!),
    enabled: enabled && online && !!workspaceId,
    staleTime: 30_000,
  });
};

export const useCreateWorkspaceMutation = createMutation<Workspace, Error, CreateWorkspaceRequest>(
  (data) => workspaceService.createWorkspace(data),
  (queryClient) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
  },
);

export const useUpdateWorkspaceMutation = createMutation<
  Workspace,
  Error,
  { machineId: string; workspaceId: string; data: UpdateWorkspaceRequest }
>(
  ({ machineId, workspaceId, data }) =>
    workspaceService.updateWorkspace(machineId, workspaceId, data),
  (queryClient, _data, { machineId }) => {
    queryClient.invalidateQueries({ queryKey: workspacesKey(machineId) });
    // Search results embed workspace_name, so a rename leaves a stale label
    // visible until the search query naturally refetches.
    queryClient.invalidateQueries({
      queryKey:
        machineId === LOCAL_MACHINE_ID
          ? queryKeys.chatsSearchAll
          : queryKeys.machine.chatsSearchAll(machineId),
    });
  },
);

export const useDeleteWorkspaceMutation = createMutation<
  void,
  Error,
  { machineId: string; workspaceId: string }
>(
  ({ machineId, workspaceId }) => workspaceService.deleteWorkspace(machineId, workspaceId),
  async (queryClient, _data, { machineId, workspaceId }) => {
    const allCachedChats = queryClient.getQueriesData<Chat>({ queryKey: ['chat'] });
    for (const [, chat] of allCachedChats) {
      if (chat?.workspace_id === workspaceId) {
        queryClient.removeQueries({ queryKey: queryKeys.chat(chat.id) });
        queryClient.removeQueries({ queryKey: queryKeys.messages(chat.id) });
        queryClient.removeQueries({ queryKey: queryKeys.contextUsage(chat.id) });
        queryClient.removeQueries({ queryKey: queryKeys.subThreads(chat.id) });
      }
    }

    const cachedChannels = queryClient.getQueriesData<Channel>({ queryKey: ['channel'] });
    for (const [, channel] of cachedChannels) {
      if (channel?.workspace_id === workspaceId) {
        queryClient.removeQueries({ queryKey: queryKeys.channel(channel.id) });
        useChannelStore.getState().releaseChannel(channel.id);
      }
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: workspacesKey(machineId) }),
      queryClient.invalidateQueries({
        queryKey:
          machineId === LOCAL_MACHINE_ID ? [queryKeys.chats] : queryKeys.machine.chats(machineId),
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.channelsAll }),
    ]);
  },
);
