import { useQuery } from '@tanstack/react-query';
import { inboxService } from '@/services/inboxService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
import { useAuthStore } from '@/store/authStore';
import type { InboxItem, InboxList } from '@/types/inbox.types';

const POLL_INTERVAL_MS = 30_000;

// Polled because push can be disabled.
export const useInboxQuery = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return useQuery<InboxList>({
    queryKey: queryKeys.inbox,
    queryFn: () => inboxService.listInbox(),
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
