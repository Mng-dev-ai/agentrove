import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { inboxService } from '@/services/inboxService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
import { listLoadState, retryTransientOnce } from '@/hooks/queries/listLoad';
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

async function appendNextInboxPage(queryClient: QueryClient, machineId: string, cursor: string) {
  const queryKey = queryKeys.machine.inbox(machineId);
  const fetchedAt = queryClient.getQueryState(queryKey)?.dataUpdatedAt;
  const page = await inboxService.listInbox(cursor, machineId);
  const state = queryClient.getQueryState(queryKey);
  if (state?.dataUpdatedAt !== fetchedAt || state?.fetchStatus !== 'idle') return;
  queryClient.setQueryData<InboxList[]>(queryKey, (pages) => pages && [...pages, page]);
}

function invalidateInbox(queryClient: QueryClient, machineId: string) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.machine.inbox(machineId) });
}

function withoutItem(page: InboxList, itemId: string): InboxList {
  return { ...page, items: page.items.filter((item) => item.id !== itemId) };
}

async function removeInboxItem(queryClient: QueryClient, machineId: string, itemId: string) {
  const queryKey = queryKeys.machine.inbox(machineId);
  await queryClient.cancelQueries({ queryKey });
  if (machineId === LOCAL_MACHINE_ID) {
    queryClient.setQueryData<InfiniteData<InboxList>>(
      queryKey,
      (data) => data && { ...data, pages: data.pages.map((page) => withoutItem(page, itemId)) },
    );
  } else {
    queryClient.setQueryData<InboxList[]>(
      queryKey,
      (pages) => pages && pages.map((page) => withoutItem(page, itemId)),
    );
  }
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
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const remoteIds = useOnlineRemoteMachineIds();

  const local = useInfiniteQuery({
    queryKey: queryKeys.machine.inbox(LOCAL_MACHINE_ID),
    queryFn: ({ pageParam }) => inboxService.listInbox(pageParam, LOCAL_MACHINE_ID),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    enabled: isAuthenticated,
    refetchInterval: POLL_INTERVAL_MS,
    retry: retryTransientOnce,
  });
  const remote = useQueries({
    queries: remoteIds.map((machineId) => ({
      queryKey: queryKeys.machine.inbox(machineId),
      queryFn: () =>
        listInboxPages(
          machineId,
          queryClient.getQueryData<InboxList[]>(queryKeys.machine.inbox(machineId))?.length ?? 1,
        ),
      enabled: isAuthenticated,
      refetchInterval: POLL_INTERVAL_MS,
      retry: retryTransientOnce,
    })),
  });
  const loadMoreRemote = useMutation({
    mutationFn: (targets: { machineId: string; cursor: string }[]) =>
      Promise.allSettled(
        targets.map(({ machineId, cursor }) => appendNextInboxPage(queryClient, machineId, cursor)),
      ),
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
    const targets = remoteIds.flatMap((machineId, index) => {
      const pages = remote[index]?.data ?? [];
      const cursor = pages[pages.length - 1]?.next_cursor;
      return cursor ? [{ machineId, cursor }] : [];
    });
    if (targets.length > 0) loadMoreRemote.mutate(targets);
  };

  return {
    machineIds: [LOCAL_MACHINE_ID, ...remoteIds],
    items: mergeRecentSources<MachineInboxItem>(sources, (entry) => entry.item.created_at),
    unreadCount: sources.reduce((total, source) => total + source.unreadCount, 0),
    hasReadItems: sources.some(
      (source) => source.hasMore || source.items.some((entry) => entry.item.read_at),
    ),
    isLoading: local.isLoading,
    load: listLoadState([local, ...remote]),
    hasMore: sources.some((source) => source.hasMore),
    isFetchingMore: local.isFetchingNextPage || loadMoreRemote.isPending,
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

export const useMarkInboxUnreadMutation = createMutation<
  InboxItem,
  Error,
  { itemId: string; machineId: string }
>(
  ({ itemId, machineId }) => inboxService.markUnread(itemId, machineId),
  (queryClient, _data, variables) => invalidateInbox(queryClient, variables.machineId),
);

export const useDeleteInboxItemMutation = createMutation<
  void,
  Error,
  { itemId: string; machineId: string }
>(
  ({ itemId, machineId }) => inboxService.deleteItem(itemId, machineId),
  async (queryClient, _data, { itemId, machineId }) => {
    await removeInboxItem(queryClient, machineId, itemId);
    await invalidateInbox(queryClient, machineId);
  },
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
