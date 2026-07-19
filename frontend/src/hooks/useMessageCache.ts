import { useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queries/queryKeys';
import type { Message } from '@/types/chat.types';
import type { PaginatedMessages } from '@/types/api.types';

interface UseMessageCacheParams {
  chatId: string | undefined;
  queryClient: QueryClient;
}

// Optimistic message writes into the infinite-query pages for the current chatId only
// (cross-chat callers must use queryClient + target chatId directly).
export function useMessageCache({ chatId, queryClient }: UseMessageCacheParams) {
  // unshift into page 0 matches backend DESC ordering.
  const addMessageToCache = useCallback(
    (message: Message, userMessage?: Message) => {
      if (!chatId) return;

      queryClient.setQueryData(
        queryKeys.messages(chatId),
        (oldData: { pages: PaginatedMessages[]; pageParams: unknown[] } | undefined) => {
          if (!oldData?.pages || oldData.pages.length === 0) return oldData;

          const newFirstPageItems = [...oldData.pages[0].items];

          if (userMessage && !newFirstPageItems.some((msg) => msg.id === userMessage.id)) {
            newFirstPageItems.unshift(userMessage);
          }

          const existingIndex = newFirstPageItems.findIndex((msg) => msg.id === message.id);
          if (existingIndex >= 0) {
            newFirstPageItems[existingIndex] = message;
          } else {
            newFirstPageItems.unshift(message);
          }

          return {
            ...oldData,
            pages: oldData.pages.map((page, idx) =>
              idx === 0 ? { ...page, items: newFirstPageItems } : page,
            ),
          };
        },
      );
    },
    [chatId, queryClient],
  );

  const removeMessagesFromCache = useCallback(
    (messageIds: string[]) => {
      if (!chatId || messageIds.length === 0) return;

      const idsToRemove = new Set(messageIds);
      queryClient.setQueryData(
        queryKeys.messages(chatId),
        (oldData: { pages: PaginatedMessages[]; pageParams: unknown[] } | undefined) => {
          if (!oldData?.pages) return oldData;
          return {
            ...oldData,
            pages: oldData.pages.map((page) => ({
              ...page,
              items: page.items.filter((msg) => !idsToRemove.has(msg.id)),
            })),
          };
        },
      );
    },
    [chatId, queryClient],
  );

  return {
    addMessageToCache,
    removeMessagesFromCache,
  };
}
