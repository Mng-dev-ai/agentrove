import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useQueries,
  useQueryClient,
  type InfiniteData,
  type UseQueryResult,
} from '@tanstack/react-query';
import { MACHINE_CHATS_PER_PAGE } from '@/config/constants';
import { infiniteChatsQueryKey, useInfiniteChatsQuery } from '@/hooks/queries/useChatQueries';
import { useMachinesWorkspaces } from '@/hooks/queries/useMachineQueries';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { listLoadState, retryTransientOnce } from '@/hooks/queries/listLoad';
import { machineChatService } from '@/services/machineChatService';
import { useMachineStore, useRemoteMachineIds } from '@/store/machineStore';
import { mergeRecentSources } from '@/utils/mergeRecentSources';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { SidebarSourceFilter } from '@/store/sidebarFilters';
import type { PaginatedChats } from '@/types/api.types';
import type { Chat } from '@/types/chat.types';
import type { Workspace } from '@/types/workspace.types';

export interface WorkspaceBadge {
  name: string;
  machineId: string;
}

interface RemoteChatSource {
  chats: Chat[];
  hasMore: boolean;
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
      // A page on its first load keeps the source's floor, or every older row flashes in.
      // errorUpdateCount outlives the reset to pending that a refetch of a failed page causes.
      source.hasMore =
        online &&
        (result.data
          ? result.data.page < result.data.pages
          : page > 1 && result.isLoading && result.errorUpdateCount === 0);
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
    (results: UseQueryResult<PaginatedChats>[]) => ({
      sources: combineRemoteSources(plan, results),
      // Later pages come from Show more; only a failed first page means the list didn't load.
      firstPages: results.filter((_, index) => plan[index].page === 1),
    }),
    [plan],
  );
  const { sources, firstPages } = useQueries({
    queries: plan.map(({ machineId, page, online }) => ({
      queryKey: queryKeys.machine.chatsPage(machineId, page),
      queryFn: () =>
        machineChatService.listChats(machineId, { page, per_page: MACHINE_CHATS_PER_PAGE }),
      enabled: enabled && online,
      staleTime: 10_000,
      refetchInterval: 15_000,
      retry: retryTransientOnce,
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
  const showLess = useCallback(() => setPageCounts({}), []);

  return {
    sources,
    firstPages,
    loadMore,
    hasMoreThanFirstPage: Object.values(pageCounts).some((count) => count > 1),
    showLess,
  };
}

// A source the filter excludes shows no rows, so it neither holds older rows back nor pages.
export function useSidebarChatLists(
  workspaces: Workspace[],
  enabled: boolean = true,
  source: SidebarSourceFilter = 'all',
) {
  const queryClient = useQueryClient();
  const pinnedQuery = useInfiniteChatsQuery({ pinned: true, enabled });
  const localQuery = useInfiniteChatsQuery({ pinned: false, enabled });
  const { data: pinnedChatsData } = pinnedQuery;
  const {
    data: localChatsData,
    hasNextPage: hasMoreLocal,
    fetchNextPage: fetchMoreLocal,
    isFetching: isFetchingLocal,
    isFetchingNextPage: isFetchingMoreLocal,
    isFetchNextPageError: localFetchMoreFailed,
    isLoading: isLoadingLocal,
  } = localQuery;
  const localPagesLoaded = localChatsData?.pages.length ?? 0;
  const pagesLocal = !!hasMoreLocal && (source === 'all' || source === LOCAL_MACHINE_ID);
  // An invalidation mid-fetch cancels the next-page fetch and refetches only the
  // loaded pages, so a pending Show more fetches again until it lands or can't.
  const [localPagesRequested, setLocalPagesRequested] = useState<number | null>(null);
  useEffect(() => {
    if (localPagesRequested === null || isFetchingLocal) return;
    if (localPagesLoaded >= localPagesRequested || !pagesLocal || localFetchMoreFailed) {
      setLocalPagesRequested(null);
    } else {
      void fetchMoreLocal();
    }
  }, [
    localPagesRequested,
    isFetchingLocal,
    localPagesLoaded,
    pagesLocal,
    localFetchMoreFailed,
    fetchMoreLocal,
  ]);
  const remoteMachineIds = useRemoteMachineIds();
  const {
    sources: remoteSources,
    firstPages: remoteFirstPages,
    loadMore: loadMoreRemote,
    hasMoreThanFirstPage: hasMoreThanFirstRemotePage,
    showLess: showLessRemote,
  } = useRemoteChatSources(remoteMachineIds, enabled);
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
    return mergeRecentSources(
      [
        { items: local, hasMore: pagesLocal },
        ...[...remoteSources].map(([machineId, remote]) => ({
          items: remote.chats.filter((chat) => !chat.pinned_at),
          hasMore: remote.hasMore && (source === 'all' || source === machineId),
        })),
      ],
      (chat) => chat.updated_at,
    );
  }, [localChatsData?.pages, pagesLocal, remoteSources, source]);

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
    .filter(([machineId, remote]) => remote.hasMore && (source === 'all' || source === machineId))
    .map(([machineId]) => machineId);
  const remoteWithMoreKey = remoteWithMore.join('\n');
  const loadMore = useCallback(() => {
    if (pagesLocal) {
      setLocalPagesRequested(localPagesLoaded + 1);
      void fetchMoreLocal();
    }
    if (remoteWithMoreKey) loadMoreRemote(remoteWithMoreKey.split('\n'));
  }, [pagesLocal, localPagesLoaded, fetchMoreLocal, remoteWithMoreKey, loadMoreRemote]);
  const showLess = useCallback(() => {
    showLessRemote();
    setLocalPagesRequested(null);
    const queryKey = infiniteChatsQueryKey({ pinned: false });
    queryClient.setQueryData<InfiniteData<PaginatedChats>>(
      queryKey,
      (data) =>
        data && {
          pages: data.pages.slice(0, 1),
          pageParams: data.pageParams.slice(0, 1),
        },
    );
    // Cancels any in-flight page fetch that would re-append the trimmed pages.
    void queryClient.invalidateQueries({ queryKey, exact: true });
  }, [queryClient, showLessRemote]);

  return {
    pinnedChats,
    recentChats,
    workspaceBadgeById,
    machineWorkspaces,
    isLoadingChats: isLoadingLocal || remoteSourceList.some((source) => source.isLoading),
    isLoadingPinned: pinnedQuery.isLoading,
    hasMore: pagesLocal || remoteWithMore.length > 0,
    isFetchingMore: isFetchingMoreLocal || remoteSourceList.some((source) => source.isFetchingMore),
    loadMore,
    canShowLess: (localChatsData?.pages.length ?? 0) > 1 || hasMoreThanFirstRemotePage,
    showLess,
    threadsLoad: listLoadState([pinnedQuery, localQuery, ...remoteFirstPages]),
    pinnedLoad: listLoadState([pinnedQuery]),
    recentsLoad: listLoadState([localQuery, ...remoteFirstPages]),
  };
}
