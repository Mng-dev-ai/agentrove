import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { UseQueryOptions } from '@tanstack/react-query';
import { workspaceService } from '@/services/workspaceService';
import type {
  Workspace,
  WorkspaceResources,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
} from '@/types/workspace.types';
import type { PaginatedResponse } from '@/types/api.types';
import type { Chat } from '@/types/chat.types';
import { createMutation } from './createMutation';
import { queryKeys } from './queryKeys';

export const useWorkspaceResourcesQuery = (
  workspaceId: string | undefined,
  chatId?: string,
  options?: Partial<UseQueryOptions<WorkspaceResources>>,
) => {
  return useQuery({
    queryKey: queryKeys.workspaceResources(workspaceId, chatId),
    queryFn: () => workspaceService.getWorkspaceResources(workspaceId!, chatId),
    enabled: !!workspaceId,
    staleTime: 30_000,
    ...options,
  });
};

export const useWorkspacesQuery = (
  options?: Partial<UseQueryOptions<PaginatedResponse<Workspace>>>,
) => {
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: () => workspaceService.listWorkspaces(),
    ...options,
  });
};

// Memoize the items array so a missing `data` doesn't yield a new `[]` reference
// each render — keeps downstream useMemo/useEffect deps stable.
export const useWorkspacesList = (
  options?: Partial<UseQueryOptions<PaginatedResponse<Workspace>>>,
): Workspace[] => {
  const { data } = useWorkspacesQuery(options);
  return useMemo(() => data?.items ?? [], [data?.items]);
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
  { workspaceId: string; data: UpdateWorkspaceRequest }
>(
  ({ workspaceId, data }) => workspaceService.updateWorkspace(workspaceId, data),
  (queryClient) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
    // Search results embed workspace_name, so a rename leaves a stale label
    // visible until the search query naturally refetches.
    queryClient.invalidateQueries({ queryKey: queryKeys.chatsSearchAll });
  },
);

export const useDeleteWorkspaceMutation = createMutation<void, Error, string>(
  (workspaceId) => workspaceService.deleteWorkspace(workspaceId),
  async (queryClient, _data, workspaceId) => {
    const allCachedChats = queryClient.getQueriesData<Chat>({ queryKey: ['chat'] });
    for (const [, chat] of allCachedChats) {
      if (chat?.workspace_id === workspaceId) {
        queryClient.removeQueries({ queryKey: queryKeys.chat(chat.id) });
        queryClient.removeQueries({ queryKey: queryKeys.messages(chat.id) });
        queryClient.removeQueries({ queryKey: queryKeys.contextUsage(chat.id) });
        queryClient.removeQueries({ queryKey: queryKeys.subThreads(chat.id) });
      }
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces }),
      queryClient.invalidateQueries({ queryKey: [queryKeys.chats] }),
    ]);
  },
);
