import { useInfiniteQuery } from '@tanstack/react-query';
import { inboxService } from '@/services/inboxService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
import { useAuthStore } from '@/store/authStore';
import type { InboxItem } from '@/types/inbox.types';

const POLL_INTERVAL_MS = 30_000;

// Polled because push can be disabled.
export const useInboxQuery = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return useInfiniteQuery({
    queryKey: queryKeys.inbox,
    queryFn: ({ pageParam }) => inboxService.listInbox(pageParam),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    enabled: isAuthenticated,
    refetchInterval: POLL_INTERVAL_MS,
  });
};

export const useMarkInboxReadMutation = createMutation<InboxItem, Error, string>(
  (itemId) => inboxService.markRead(itemId),
  (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.inbox }),
);

export const useMarkAllInboxReadMutation = createMutation<void, Error, void>(
  () => inboxService.markAllRead(),
  (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.inbox }),
);
