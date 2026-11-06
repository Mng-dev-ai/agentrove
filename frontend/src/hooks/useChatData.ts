import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useInfiniteMessagesQuery, useChatQuery } from '@/hooks/queries/useChatQueries';
import { useChatMachineId } from '@/store/machineOrigin';
import { useOnlineRemoteMachineIds } from '@/store/machineStore';
import type { Message } from '@/types/chat.types';

interface UseChatDataResult {
  currentChat: ReturnType<typeof useChatQuery>['data'];
  fetchedMessages: Message[];
  hasFetchedMessages: boolean;
  messagesQuery: ReturnType<typeof useInfiniteMessagesQuery>;
}

export function useChatData(chatId: string | undefined): UseChatDataResult {
  const chatQuery = useChatQuery(chatId, { enabled: !!chatId });
  const messagesQuery = useInfiniteMessagesQuery(chatId);
  const queryClient = useQueryClient();
  const machineId = useChatMachineId(chatId);
  const onlineMachineIds = useOnlineRemoteMachineIds();

  useEffect(() => {
    if (!chatId) return;
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[1] === chatId && query.state.status === 'error',
    });
  }, [chatId, machineId, onlineMachineIds, queryClient]);

  const fetchedMessages = useMemo(() => {
    if (!messagesQuery.data?.pages) return [];
    // Backend pages are DESC (newest first); reverse pages and items for chronological UI.
    const reversedPages = [...messagesQuery.data.pages].reverse();
    const allMessages = reversedPages.flatMap((page) => [...page.items].reverse());
    const seen = new Set<string>();
    return allMessages.filter((msg) => {
      if (seen.has(msg.id)) return false;
      seen.add(msg.id);
      return true;
    });
  }, [messagesQuery.data?.pages]);

  return {
    currentChat: chatQuery.data,
    fetchedMessages,
    hasFetchedMessages: fetchedMessages.length > 0,
    messagesQuery,
  };
}
