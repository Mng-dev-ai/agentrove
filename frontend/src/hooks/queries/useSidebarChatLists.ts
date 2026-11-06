import { useCallback, useMemo, useState } from 'react';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { MACHINE_CHATS_PER_PAGE } from '@/config/constants';
import { useInfiniteChatsQuery } from '@/hooks/queries/useChatQueries';
import { useMachinesWorkspaces } from '@/hooks/queries/useMachineQueries';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { machineChatService } from '@/services/machineChatService';
import { useMachineStore, useRemoteMachineIds } from '@/store/machineStore';
import { mergeRecentChatSources, type RecentChatSource } from '@/utils/mergeChatSources';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { PaginatedChats } from '@/types/api.types';
import type { Workspace } from '@/types/workspace.types';

export interface WorkspaceBadge {
  name: string;
  machineId: string;
}

interface RemoteChatSource extends RecentChatSource {
  isLoading: boolean;
  isFetchingMore: boolean;
}

interface PagePlan {
  machineId: string;
  page: number;
  online: boolean;
  isLastPage: boolean;
}

function combineRemoteSources(
  plan: PagePlan[],
  results: UseQueryResult<PaginatedChats>[],
): Map<string, RemoteChatSource> {
  const sources = new Map<string, RemoteChatSource>();
  plan.forEach(({ machineId, page, online, isLastPage }, index) => {
    const result = results[index];
    const source = sources.get(machineId) ?? {
      chats: [],
      hasMore: false,
      isLoading: false,
      isFetchingMore: false,
    };
    const seen = new Set(source.chats.map((chat) => chat.id));
    const items = result.data?.items ?? [];
    source.chats = [...source.chats, ...items.filter((chat) => !seen.has(chat.id))];
    if (isLastPage) {
      source.hasMore = online && !!result.data && result.data.page < result.data.pages;
    }
    source.isLoading ||= online && result.isLoading;
    source.isFetchingMore ||= page > 1 && result.isFetching;
    sources.set(machineId, source);
  });
  return sources;
}

function useRemoteChatSources(machineIds: string[], enabled: boolean) {
  const onlineKey = useMachineStore((state) =>
    machineIds.map((id) => state.connections[id]?.status === 'online').join(','),
  );
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({});

  const plan = useMemo(() => {
    const online = onlineKey.split(',');
    return machineIds.flatMap((machineId, machineIndex) => {
      const pages = pageCounts[machineId] ?? 1;
      return Array.from({ length: pages }, (_, index) => ({
        machineId,
        page: index + 1,
        online: online[machineIndex] === 'true',
        isLastPage: index + 1 === pages,
      }));
    });
  }, [machineIds, onlineKey, pageCounts]);

  const combine = useCallback(
    (results: UseQueryResult<PaginatedChats>[]) => combineRemoteSources(plan, results),
    [plan],
  );
  const sources = useQueries({
    queries: plan.map(({ machineId, page, online }) => ({
      queryKey: queryKeys.machine.chatsPage(machineId, page),
      queryFn: () =>
        machineChatService.listChats(machineId, { page, per_page: MACHINE_CHATS_PER_PAGE }),
      enabled: enabled && online,
      staleTime: 10_000,
      refetchInterval: 15_000,
    })),
    combine,
  });

  const loadMore = useCallback(
    (machineIdsWithMore: string[]) =>
      setPageCounts((counts) => {
        const next = { ...counts };
        for (const machineId of machineIdsWithMore) next[machineId] = (counts[machineId] ?? 1) + 1;
        return next;
      }),
    [],
  );

  return { sources, loadMore };
}

export function useSidebarChatLists(workspaces: Workspace[], enabled: boolean = true) {
  const { data: pinnedChatsData } = useInfiniteChatsQuery({ pinned: true, enabled });
  const {
    data: localChatsData,
    hasNextPage: hasMoreLocal,
    fetchNextPage: fetchMoreLocal,
    isFetchingNextPage: isFetchingMoreLocal,
    isLoading: isLoadingLocal,
  } = useInfiniteChatsQuery({ pinned: false, enabled });
  const remoteMachineIds = useRemoteMachineIds();
  const { sources: remoteSources, loadMore: loadMoreRemote } = useRemoteChatSources(
    remoteMachineIds,
    enabled,
  );
  const remoteSourceList = useMemo(() => [...remoteSources.values()], [remoteSources]);

  const pinnedChats = useMemo(() => {
    const localPinned = pinnedChatsData?.pages.flatMap((page) => page.items) ?? [];
    const remotePinned = remoteSourceList.flatMap((source) =>
      source.chats.filter((chat) => chat.pinned_at),
    );
    return [...localPinned, ...remotePinned].sort(
      (a, b) => Date.parse(b.pinned_at!) - Date.parse(a.pinned_at!),
    );
  }, [pinnedChatsData?.pages, remoteSourceList]);

  const recentChats = useMemo(() => {
    const local = localChatsData?.pages.flatMap((page) => page.items) ?? [];
    return mergeRecentChatSources([
      { chats: local, hasMore: !!hasMoreLocal },
      ...remoteSourceList.map((source) => ({
        chats: source.chats.filter((chat) => !chat.pinned_at),
        hasMore: source.hasMore,
      })),
    ]);
  }, [localChatsData?.pages, hasMoreLocal, remoteSourceList]);

  const machineWorkspaces = useMachinesWorkspaces(remoteMachineIds, enabled);
  const workspaceBadgeById = useMemo(() => {
    const map = new Map<string, WorkspaceBadge>();
    for (const workspace of workspaces) {
      map.set(workspace.id, { name: workspace.name, machineId: LOCAL_MACHINE_ID });
    }
    for (const [machineId, list] of Object.entries(machineWorkspaces)) {
      for (const workspace of list) map.set(workspace.id, { name: workspace.name, machineId });
    }
    return map;
  }, [workspaces, machineWorkspaces]);

  const remoteWithMore = [...remoteSources.entries()]
    .filter(([, source]) => source.hasMore)
    .map(([machineId]) => machineId);
  const remoteWithMoreKey = remoteWithMore.join('\n');
  const loadMore = useCallback(() => {
    if (hasMoreLocal) void fetchMoreLocal();
    if (remoteWithMoreKey) loadMoreRemote(remoteWithMoreKey.split('\n'));
  }, [hasMoreLocal, fetchMoreLocal, remoteWithMoreKey, loadMoreRemote]);

  return {
    pinnedChats,
    recentChats,
    workspaceBadgeById,
    machineWorkspaces,
    isLoadingChats: isLoadingLocal || remoteSourceList.some((source) => source.isLoading),
    hasMore: !!hasMoreLocal || remoteWithMore.length > 0,
    isFetchingMore: isFetchingMoreLocal || remoteSourceList.some((source) => source.isFetchingMore),
    loadMore,
  };
}
