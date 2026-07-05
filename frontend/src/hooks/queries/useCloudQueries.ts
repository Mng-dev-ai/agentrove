import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
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

const CLOUD_CHATS_PER_PAGE = 25;

// Keyed by cloudUrl + connectedEmail so switching instance or account never
// serves the previous connection's cached list.
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

// Rename/delete a VPS workspace. cloudUrl + connectedEmail are read at cache-update
// time so the invalidation targets the same instance/account the query is keyed by.
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
      // Prefix-invalidate every project's cloud chats — the deleted workspace's
      // chats are gone server-side and the sidebar list must drop them.
      queryClient.invalidateQueries({ queryKey: queryKeys.cloudChatsAll }),
    ]);
  },
);

// VPS workspace skills and builtin slash-commands for the landing composer
// before a chat exists. Keyed by cloudUrl + connectedEmail + workspaceId so
// switching instance or account never serves the previous connection's cache.
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

// VPS user settings. Only personas are consumed on the landing page — local
// settings (env vars, GitHub token, etc.) are separate. Keyed by cloudUrl +
// connectedEmail so switching instance or account never serves stale cache.
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

// Chats currently running on the VPS — the settings tab shows the count in its
// connection overview. Polled so the number stays live while the tab is open.
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

// Total chat count across all VPS workspaces for the settings connection
// overview. per_page 1 keeps the payload minimal — only `total` is consumed.
// Key extends queryKeys.cloudChats so existing invalidations prefix-match it.
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

// Cloud chats across all VPS projects, paginated like the local sidebar list. The
// queryFn registers returned IDs as cloud-owned (markCloudChats), so opening one
// routes its messages/status/SSE to the VPS. New chats and runs arrive live via
// the cloud events feed (useCloudChatEvents); the poll is a safety net for
// changes the feed doesn't carry (titles, deletes, other-device edits). Key
// extends queryKeys.cloudChats so the LandingPage invalidation prefix-matches it.
export const useInfiniteCloudChatsQuery = () => {
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
    enabled: !!cloudUrl,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
};
