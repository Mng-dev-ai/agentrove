import { useCallback, useMemo } from 'react';
import { useInfiniteChatsQuery } from '@/hooks/queries/useChatQueries';
import {
  useCloudWorkspacesQuery,
  useInfiniteCloudChatsQuery,
} from '@/hooks/queries/useCloudQueries';
import type { Workspace } from '@/types/workspace.types';

// The workspace a chat belongs to, shown as a badge on the row; cloud workspaces
// live on the connected VPS and get a cloud icon. Identified by chat.workspace_id.
export interface WorkspaceBadge {
  name: string;
  isCloud: boolean;
}

// Sidebar chat data: local and cloud chats live on separate backends, so three
// queries (local pinned, local unpinned, cloud) are merged client-side into the
// Pinned and Recents lists, with one loadMore advancing both paginated sources.
export function useSidebarChatLists(workspaces: Workspace[], enabled: boolean = true) {
  const { data: pinnedChatsData } = useInfiniteChatsQuery({ pinned: true, enabled });
  const {
    data: localChatsData,
    hasNextPage: hasMoreLocal,
    fetchNextPage: fetchMoreLocal,
    isFetchingNextPage: isFetchingMoreLocal,
    isLoading: isLoadingLocal,
  } = useInfiniteChatsQuery({ pinned: false, enabled });
  const {
    data: cloudChatsData,
    hasNextPage: hasMoreCloud,
    fetchNextPage: fetchMoreCloud,
    isFetchingNextPage: isFetchingMoreCloud,
    isLoading: isLoadingCloud,
  } = useInfiniteCloudChatsQuery(enabled);

  const cloudChats = useMemo(
    () => cloudChatsData?.pages.flatMap((page) => page.items) ?? [],
    [cloudChatsData?.pages],
  );

  // Pinned cloud chats ride along in the unfiltered cloud list — the VPS sorts pinned
  // first, so loaded pages always contain every pinned cloud chat.
  const pinnedChats = useMemo(() => {
    const localPinned = pinnedChatsData?.pages.flatMap((page) => page.items) ?? [];
    const cloudPinned = cloudChats.filter((chat) => chat.pinned_at);
    return [...localPinned, ...cloudPinned].sort(
      (a, b) => Date.parse(b.pinned_at!) - Date.parse(a.pinned_at!),
    );
  }, [pinnedChatsData?.pages, cloudChats]);

  // One recency-ordered list spanning every workspace, merged client-side by updated_at.
  const recentChats = useMemo(() => {
    const local = localChatsData?.pages.flatMap((page) => page.items) ?? [];
    const cloud = cloudChats.filter((chat) => !chat.pinned_at);
    const merged = [...local, ...cloud].sort(
      (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
    );
    // Windowed merge: while a source still has unloaded pages, anything older than its
    // oldest loaded chat can't be placed yet — an unloaded chat from that source may be
    // newer. Hold those rows back; Load more advances the window. Both backends return
    // newest-first, so each source's oldest loaded chat is its last element (cloud lists
    // pinned first, but those are filtered out and the unpinned tail stays newest-first).
    let floor = -Infinity;
    if (hasMoreLocal && local.length > 0) {
      floor = Math.max(floor, Date.parse(local[local.length - 1].updated_at));
    }
    if (hasMoreCloud && cloud.length > 0) {
      floor = Math.max(floor, Date.parse(cloud[cloud.length - 1].updated_at));
    }
    return merged.filter((chat) => Date.parse(chat.updated_at) >= floor);
  }, [localChatsData?.pages, cloudChats, hasMoreLocal, hasMoreCloud]);

  // Resolves each row's workspace badge; cloud workspaces carry the cloud icon and
  // route rename/delete to the VPS. Workspace IDs are UUIDs from separate DBs — no collisions.
  const { data: cloudWorkspaces } = useCloudWorkspacesQuery(enabled);
  const workspaceBadgeById = useMemo(() => {
    const map = new Map<string, WorkspaceBadge>();
    for (const workspace of workspaces) {
      map.set(workspace.id, { name: workspace.name, isCloud: false });
    }
    for (const workspace of cloudWorkspaces ?? []) {
      map.set(workspace.id, { name: workspace.name, isCloud: true });
    }
    return map;
  }, [workspaces, cloudWorkspaces]);

  const loadMore = useCallback(() => {
    // Both sources page independently; advance whichever still has more.
    if (hasMoreLocal) void fetchMoreLocal();
    if (hasMoreCloud) void fetchMoreCloud();
  }, [hasMoreLocal, fetchMoreLocal, hasMoreCloud, fetchMoreCloud]);

  return {
    pinnedChats,
    recentChats,
    workspaceBadgeById,
    cloudWorkspaces,
    isLoadingChats: isLoadingLocal || isLoadingCloud,
    hasMore: !!hasMoreLocal || !!hasMoreCloud,
    isFetchingMore: isFetchingMoreLocal || isFetchingMoreCloud,
    loadMore,
  };
}
