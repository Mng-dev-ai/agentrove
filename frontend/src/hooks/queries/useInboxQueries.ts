import { useState } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQueries,
  type QueryClient,
} from '@tanstack/react-query';
import { inboxService } from '@/services/inboxService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
import { useAuthStore } from '@/store/authStore';
import { useOnlineRemoteMachineIds } from '@/store/machineStore';
import { mergeRecentSources } from '@/utils/mergeRecentSources';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { InboxItem, InboxList } from '@/types/inbox.types';

const POLL_INTERVAL_MS = 30_000;

export interface MachineInboxItem {
  item: InboxItem;
  machineId: string;
}

async function listInboxPages(machineId: string, pageCount: number): Promise<InboxList[]> {
  const pages: InboxList[] = [];
  let cursor: string | undefined;
  do {
    const page = await inboxService.listInbox(cursor, machineId);
    pages.push(page);
    cursor = page.next_cursor ?? undefined;
  } while (cursor && pages.length < pageCount);
  return pages;
}

function invalidateInbox(queryClient: QueryClient, machineId: string) {
  return queryClient.invalidateQueries({
    queryKey:
      machineId === LOCAL_MACHINE_ID ? queryKeys.inbox : queryKeys.machine.inboxAll(machineId),
  });
}

async function failedMachines(
  machineIds: string[],
  action: (machineId: string) => Promise<void>,
): Promise<string[]> {
  const results = await Promise.allSettled(machineIds.map(action));
  return machineIds.filter((_, index) => results[index].status === 'rejected');
}

// Polled because push can be disabled.
export const useInboxAcrossMachines = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const remoteIds = useOnlineRemoteMachineIds();
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({});

  const local = useInfiniteQuery({
    queryKey: queryKeys.inbox,
    queryFn: ({ pageParam }) => inboxService.listInbox(pageParam, LOCAL_MACHINE_ID),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    enabled: isAuthenticated,
    refetchInterval: POLL_INTERVAL_MS,
  });
  const remote = useQueries({
    queries: remoteIds.map((machineId) => {
      const pageCount = pageCounts[machineId] ?? 1;
      return {
        queryKey: queryKeys.machine.inbox(machineId, pageCount),
        queryFn: () => listInboxPages(machineId, pageCount),
        enabled: isAuthenticated,
        refetchInterval: POLL_INTERVAL_MS,
        placeholderData: keepPreviousData,
      };
    }),
  });

  const sources = [
    { machineId: LOCAL_MACHINE_ID, pages: local.data?.pages ?? [], hasMore: !!local.hasNextPage },
    ...remoteIds.map((machineId, index) => {
      const pages = remote[index]?.data ?? [];
      return { machineId, pages, hasMore: !!pages[pages.length - 1]?.next_cursor };
    }),
  ].map(({ machineId, pages, hasMore }) => ({
    machineId,
    hasMore,
    unreadCount: pages[0]?.unread_count ?? 0,
    items: pages.flatMap((page) => page.items.map((item) => ({ item, machineId }))),
  }));

  const loadMore = () => {
    if (local.hasNextPage) void local.fetchNextPage();
    setPageCounts((counts) => {
      const next = { ...counts };
      for (const source of sources) {
        if (source.machineId !== LOCAL_MACHINE_ID && source.hasMore) {
          next[source.machineId] = (counts[source.machineId] ?? 1) + 1;
        }
      }
      return next;
    });
  };

  return {
    machineIds: [LOCAL_MACHINE_ID, ...remoteIds],
    items: mergeRecentSources<MachineInboxItem>(sources, (entry) => entry.item.created_at),
    unreadCount: sources.reduce((total, source) => total + source.unreadCount, 0),
    hasReadItems: sources.some(
      (source) => source.hasMore || source.items.some((entry) => entry.item.read_at),
    ),
    isLoading: local.isLoading,
    hasMore: sources.some((source) => source.hasMore),
    isFetchingMore: local.isFetchingNextPage || remote.some((result) => result.isPlaceholderData),
    loadMore,
  };
};

export const useMarkInboxReadMutation = createMutation<
  InboxItem,
  Error,
  { itemId: string; machineId: string }
>(
  ({ itemId, machineId }) => inboxService.markRead(itemId, machineId),
  (queryClient, _data, variables) => invalidateInbox(queryClient, variables.machineId),
);

export const useMarkAllInboxReadMutation = createMutation<string[], Error, string[]>(
  (machineIds) => failedMachines(machineIds, inboxService.markAllRead),
  async (queryClient, _failed, machineIds) => {
    await Promise.all(machineIds.map((machineId) => invalidateInbox(queryClient, machineId)));
  },
);

export const useClearReadInboxMutation = createMutation<string[], Error, string[]>(
  (machineIds) => failedMachines(machineIds, inboxService.clearRead),
  async (queryClient, _failed, machineIds) => {
    await Promise.all(machineIds.map((machineId) => invalidateInbox(queryClient, machineId)));
  },
);
