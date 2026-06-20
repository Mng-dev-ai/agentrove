import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { cloudChatService } from '@/services/cloudChatService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import type { Workspace, WorkspaceResources } from '@/types/workspace.types';
import type { UserSettings } from '@/types/user.types';

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

// Cloud chats for one project, paginated like the local sidebar groups. The
// queryFn registers returned IDs as cloud-owned (markCloudChats), so opening one
// routes its messages/status/SSE to the VPS. Polled so cloud-side activity (new
// chats, runs starting) surfaces without a manual refresh — the desktop has no
// push channel for cloud state. Key extends queryKeys.cloudChats so the
// LandingPage invalidation prefix-matches every project's query.
export const useInfiniteCloudChatsQuery = (workspaceId: string, enabled: boolean) => {
  const cloudUrl = useCloudSettingsStore((state) => state.cloudUrl);
  const connectedEmail = useCloudSettingsStore((state) => state.connectedEmail);
  return useInfiniteQuery({
    queryKey: [...queryKeys.cloudChats(cloudUrl, connectedEmail), 'infinite', workspaceId] as const,
    queryFn: ({ pageParam }) =>
      cloudChatService.listChats({
        page: pageParam as number,
        per_page: CLOUD_CHATS_PER_PAGE,
        workspace_id: workspaceId,
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
