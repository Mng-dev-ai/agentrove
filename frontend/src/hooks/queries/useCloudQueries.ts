import { useQuery, useInfiniteQuery, keepPreviousData } from '@tanstack/react-query';
import { cloudChatService } from '@/services/cloudChatService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import type {
  Workspace,
  WorkspaceResources,
  UpdateWorkspaceRequest,
} from '@/types/workspace.types';
import type { UserSettings } from '@/types/user.types';
import type { ActiveStreamSnapshot } from '@/types/stream.types';
import type { ChatSearchResponse } from '@/types/chat.types';

const CLOUD_CHATS_PER_PAGE = 25;

// Keyed by cloudUrl + connectedEmail so instance/account switches don't serve stale cache.
export const useCloudWorkspacesQuery = (enabled: boolean) => {
  const cloudUrl = useCloudSettingsStore((state) => state.cloudUrl);
  const connectedEmail = useCloudSettingsStore((state) => state.connectedEmail);
  return useQuery<Workspace[]>({
    queryKey: queryKeys.cloudWorkspaces(cloudUrl, connectedEmail),
    queryFn: () => cloudChatService.listWorkspaces(),
    enabled: enabled && !!cloudUrl,
    staleTime: 30_000,
  });
};

// Read cloudUrl/email at invalidate time so the key matches the active instance.
export const useCloudUpdateWorkspaceMutation = createMutation<
  Workspace,
  Error,
  { workspaceId: string; data: UpdateWorkspaceRequest }
>(
  ({ workspaceId, data }) => cloudChatService.updateWorkspace(workspaceId, data),
  (queryClient) => {
    const { cloudUrl, connectedEmail } = useCloudSettingsStore.getState();
    queryClient.invalidateQueries({
      queryKey: queryKeys.cloudWorkspaces(cloudUrl, connectedEmail),
    });
  },
);

export const useCloudDeleteWorkspaceMutation = createMutation<void, Error, string>(
  (workspaceId) => cloudChatService.deleteWorkspace(workspaceId),
  async (queryClient) => {
    const { cloudUrl, connectedEmail } = useCloudSettingsStore.getState();
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.cloudWorkspaces(cloudUrl, connectedEmail),
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.cloudChatsAll }),
    ]);
  },
);

// Landing composer resources before a chat exists; keyed by instance + account + workspace.
export const useCloudWorkspaceResourcesQuery = (
  workspaceId: string | undefined,
  enabled: boolean,
) => {
  const cloudUrl = useCloudSettingsStore((state) => state.cloudUrl);
  const connectedEmail = useCloudSettingsStore((state) => state.connectedEmail);
  return useQuery<WorkspaceResources>({
    queryKey: queryKeys.cloudWorkspaceResources(cloudUrl, connectedEmail, workspaceId),
    queryFn: () => cloudChatService.getWorkspaceResources(workspaceId!),
    enabled: enabled && !!cloudUrl && !!workspaceId,
    staleTime: 30_000,
  });
};

// VPS settings (landing uses personas only). Keyed by instance + account.
export const useCloudSettingsQuery = (enabled: boolean) => {
  const cloudUrl = useCloudSettingsStore((state) => state.cloudUrl);
  const connectedEmail = useCloudSettingsStore((state) => state.connectedEmail);
  return useQuery<UserSettings>({
    queryKey: queryKeys.cloudSettings(cloudUrl, connectedEmail),
    queryFn: () => cloudChatService.getSettings(),
    enabled: enabled && !!cloudUrl,
    staleTime: 30_000,
  });
};

// Polled active VPS stream count for settings connection overview.
export const useCloudActiveStreamsQuery = (enabled: boolean) => {
  const cloudUrl = useCloudSettingsStore((state) => state.cloudUrl);
  const connectedEmail = useCloudSettingsStore((state) => state.connectedEmail);
  return useQuery<ActiveStreamSnapshot[]>({
    queryKey: queryKeys.cloudActiveStreams(cloudUrl, connectedEmail),
    queryFn: () => cloudChatService.getActiveStreams(),
    enabled: enabled && !!cloudUrl,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
};

// Settings total only — per_page 1. Key under cloudChats so invalidations prefix-match.
export const useCloudChatsTotalQuery = (enabled: boolean) => {
  const cloudUrl = useCloudSettingsStore((state) => state.cloudUrl);
  const connectedEmail = useCloudSettingsStore((state) => state.connectedEmail);
  return useQuery({
    queryKey: [...queryKeys.cloudChats(cloudUrl, connectedEmail), 'total'] as const,
    queryFn: () => cloudChatService.listChats({ page: 1, per_page: 1 }),
    select: (data) => data.total,
    enabled: enabled && !!cloudUrl,
    staleTime: 30_000,
  });
};

// Cloud twin of useSearchChatsQuery; key under cloudChats for prefix invalidations.
export const useSearchCloudChatsQuery = (query: string) => {
  const cloudUrl = useCloudSettingsStore((state) => state.cloudUrl);
  const connectedEmail = useCloudSettingsStore((state) => state.connectedEmail);
  const trimmed = query.trim();
  return useQuery<ChatSearchResponse>({
    queryKey: [...queryKeys.cloudChats(cloudUrl, connectedEmail), 'search', trimmed] as const,
    queryFn: () => cloudChatService.searchChats(trimmed),
    enabled: !!cloudUrl && trimmed.length >= 2,
    // No placeholder after disconnect — held-over VPS rows would misroute when opened.
    placeholderData: cloudUrl ? keepPreviousData : undefined,
    staleTime: 15_000,
  });
};

// Paginated VPS chats; queryFn markCloudChats for routing. Poll safety-nets non-feed changes.
export const useInfiniteCloudChatsQuery = (enabled: boolean = true) => {
  const cloudUrl = useCloudSettingsStore((state) => state.cloudUrl);
  const connectedEmail = useCloudSettingsStore((state) => state.connectedEmail);
  return useInfiniteQuery({
    queryKey: [...queryKeys.cloudChats(cloudUrl, connectedEmail), 'infinite'] as const,
    queryFn: ({ pageParam }) =>
      cloudChatService.listChats({
        page: pageParam as number,
        per_page: CLOUD_CHATS_PER_PAGE,
      }),
    getNextPageParam: (lastPage) => {
      const nextPage = lastPage.page + 1;
      return nextPage <= lastPage.pages ? nextPage : undefined;
    },
    initialPageParam: 1,
    enabled: enabled && !!cloudUrl,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
};
