import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useQueries,
  useQueryClient,
  type InfiniteData,
  type Query,
  type UseQueryResult,
} from '@tanstack/react-query';
import { MACHINE_CHATS_PER_PAGE, SHOW_MORE_MAX_PAGE_ROUNDS } from '@/config/constants';
import { infiniteChatsQueryKey, useInfiniteChatsQuery } from '@/hooks/queries/useChatQueries';
import { useMachinesWorkspaces } from '@/hooks/queries/useMachineQueries';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { listLoadState, retryTransientOnce } from '@/hooks/queries/listLoad';
import { useMachineStore, useRemoteMachineIds } from '@/store/machineStore';
import { mergeRecentSources } from '@/utils/mergeRecentSources';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { chatService } from '@/services/chatService';
import type { SidebarFilters, SidebarSourceFilter } from '@/store/sidebarFilters';
import type { PaginatedChats } from '@/types/api.types';
import type { Chat } from '@/types/chat.types';
import type { Workspace } from '@/types/workspace.types';

export interface WorkspaceBadge {
  name: string;
  machineId: string;
}

// The state of a source's last requested page: nothing beyond it, more to request, on
// its first load, or failed and waiting for a Show more click to retry it.
type Tail = 'end' | 'more' | 'loading' | 'failed';

interface RemoteChatSource {
  chats: Chat[];
  tail: Tail;
  isLoading: boolean;
}

interface PagePlan {
  machineId: string;
  page: number;
  online: boolean;
  isLastPage: boolean;
}

function sourceIncludes(source: SidebarSourceFilter, machineId: string): boolean {
  return source === 'all' || source === machineId;
}

// errorUpdateCount outlives the reset to pending that refetching a failed page causes.
function isFailedLaterPage(
  page: number,
  state: { data: unknown; errorUpdateCount: number },
): boolean {
  return page > 1 && state.data === undefined && state.errorUpdateCount > 0;
}

function tailOf(page: number, result: UseQueryResult<PaginatedChats>): Tail {
  if (result.data) return result.data.page < result.data.pages ? 'more' : 'end';
  if (page === 1) return 'end';
  return isFailedLaterPage(page, result) && !result.isFetching ? 'failed' : 'loading';
}

function combineRemoteSources(
  plan: PagePlan[],
  results: UseQueryResult<PaginatedChats>[],
  source: SidebarSourceFilter,
): Map<string, RemoteChatSource> {
  const sources = new Map<string, RemoteChatSource>();
  plan.forEach(({ machineId, page, online, isLastPage }, index) => {
    const result = results[index];
    const remote: RemoteChatSource = sources.get(machineId) ?? {
      chats: [],
      tail: 'end',
      isLoading: false,
    };
    const seen = new Set(remote.chats.map((chat) => chat.id));
    const items = result.data?.items ?? [];
    remote.chats = [...remote.chats, ...items.filter((chat) => !seen.has(chat.id))];
    // A source that is offline or that the filter excludes shows nothing further, so it
    // neither holds older rows back nor pages.
    if (isLastPage && online && sourceIncludes(source, machineId)) {
      remote.tail = tailOf(page, result);
    }
    remote.isLoading ||= online && result.isLoading;
    sources.set(machineId, remote);
  });
  return sources;
}

function useRemoteChatSources(machineIds: string[], enabled: boolean, source: SidebarSourceFilter) {
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
    (results: UseQueryResult<PaginatedChats>[]) => {
      const sources = combineRemoteSources(plan, results, source);
      return {
        sources,
        // Later pages come from Show more; only a failed first page means the list didn't load.
        firstPages: results.filter((_, index) => plan[index].page === 1),
        failedPages: results.filter(
          (_, index) =>
            plan[index].isLastPage && sources.get(plan[index].machineId)?.tail === 'failed',
        ),
      };
    },
    [plan, source],
  );
  const { sources, firstPages, failedPages } = useQueries({
    queries: plan.map(({ machineId, page, online }) => ({
      queryKey: queryKeys.machine.chatsPage(machineId, page),
      queryFn: () => chatService.listChats(machineId, { page, per_page: MACHINE_CHATS_PER_PAGE }),
      // A failed Show more page waits for a click: disabled, no interval, focus or
      // invalidation refetches it, so the button never shows Loading on its own.
      enabled: (query: Query<PaginatedChats>) =>
        enabled && online && !isFailedLaterPage(page, query.state),
      staleTime: 10_000,
      refetchInterval: 15_000,
      retry: retryTransientOnce,
    })),
    combine,
  });

  const loadMore = useCallback(() => {
    for (const failedPage of failedPages) void failedPage.refetch();
    setPageCounts((counts) => {
      const next = { ...counts };
      for (const [machineId, remote] of sources) {
        if (remote.tail === 'more') next[machineId] = (counts[machineId] ?? 1) + 1;
      }
      return next;
    });
  }, [failedPages, sources]);
  const showLess = useCallback(() => setPageCounts({}), []);

  return {
    sources,
    firstPages,
    loadMore,
    hasMoreThanFirstPage: Object.values(pageCounts).some((count) => count > 1),
    showLess,
  };
}

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
    isFetchNextPageError: localFetchMoreFailed,
    isLoading: isLoadingLocal,
  } = localQuery;
  const localPagesLoaded = localChatsData?.pages.length ?? 0;
  // Like an excluded remote: the filter hides its rows, so it neither holds older rows
  // back nor pages.
  const pagesLocal = !!hasMoreLocal && sourceIncludes(source, LOCAL_MACHINE_ID);
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
  } = useRemoteChatSources(remoteMachineIds, enabled, source);
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
        ...remoteSourceList.map((remote) => ({
          items: remote.chats.filter((chat) => !chat.pinned_at),
          hasMore: remote.tail !== 'end',
        })),
      ],
      (chat) => chat.updated_at,
    );
  }, [localChatsData?.pages, pagesLocal, remoteSourceList]);

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

  const loadMore = useCallback(() => {
    if (pagesLocal) {
      setLocalPagesRequested(localPagesLoaded + 1);
      void fetchMoreLocal();
    }
    loadMoreRemote();
  }, [pagesLocal, localPagesLoaded, fetchMoreLocal, loadMoreRemote]);
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
    hasMore: pagesLocal || remoteSourceList.some((remote) => remote.tail !== 'end'),
    isFetchingMore:
      (pagesLocal && localPagesRequested !== null) ||
      remoteSourceList.some((remote) => remote.tail === 'loading'),
    loadMoreFailed:
      (pagesLocal && localFetchMoreFailed) ||
      remoteSourceList.some((remote) => remote.tail === 'failed'),
    loadMore,
    canShowLess: (localChatsData?.pages.length ?? 0) > 1 || hasMoreThanFirstRemotePage,
    showLess,
    threadsLoad: listLoadState([pinnedQuery, localQuery, ...remoteFirstPages]),
    pinnedLoad: listLoadState([pinnedQuery]),
    recentsLoad: listLoadState([localQuery, ...remoteFirstPages]),
  };
}

type ShowMorePaging = Pick<
  ReturnType<typeof useSidebarChatLists>,
  'hasMore' | 'canShowLess' | 'isFetchingMore' | 'loadMoreFailed' | 'loadMore' | 'showLess'
>;

// Filters narrow loaded pages client-side, so a fetched page can add no visible row: one
// click keeps paging until a match shows, nothing is left, a page fails or the cap is hit.
// `filters` is null when paging further cannot surface a match; a new object ends the run.
export function useShowMoreUntilMatch(
  { hasMore, canShowLess, isFetchingMore, loadMoreFailed, loadMore, showLess }: ShowMorePaging,
  matchCount: number,
  filters: SidebarFilters | null,
) {
  const [run, setRun] = useState<{
    roundsLeft: number;
    matchCount: number;
    filters: SidebarFilters;
  } | null>(null);
  useEffect(() => {
    if (!run || isFetchingMore) return;
    if (
      run.filters !== filters ||
      matchCount > run.matchCount ||
      !hasMore ||
      loadMoreFailed ||
      run.roundsLeft === 0
    ) {
      setRun(null);
    } else {
      setRun({ ...run, roundsLeft: run.roundsLeft - 1 });
      loadMore();
    }
  }, [run, isFetchingMore, filters, matchCount, hasMore, loadMoreFailed, loadMore]);

  return {
    hasMore,
    canShowLess,
    isFetchingMore: isFetchingMore || run !== null,
    loadMore: () => {
      if (filters && !loadMoreFailed) {
        setRun({ roundsLeft: SHOW_MORE_MAX_PAGE_ROUNDS - 1, matchCount, filters });
      }
      loadMore();
    },
    showLess: () => {
      setRun(null);
      showLess();
    },
  };
}
