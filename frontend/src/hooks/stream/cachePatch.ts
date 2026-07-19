import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { patchChatInCache } from '@/hooks/queries/useChatQueries';
import type { Message } from '@/types/chat.types';
import type { PaginatedMessages } from '@/types/api.types';

// Explicit chatId (unlike useMessageCache) — needed when off-screen streams flush.
export function updateMessageInCacheForChat(
  queryClient: QueryClient,
  chatId: string,
  messageId: string,
  updater: (msg: Message) => Message,
) {
  queryClient.setQueryData(
    queryKeys.messages(chatId),
    (oldData: { pages: PaginatedMessages[]; pageParams: unknown[] } | undefined) => {
      if (!oldData?.pages) return oldData;
      return {
        ...oldData,
        pages: oldData.pages.map((page: PaginatedMessages) => ({
          ...page,
          items: page.items.map((msg: Message) => (msg.id === messageId ? updater(msg) : msg)),
        })),
      };
    },
  );
}

export function patchChatWorktreeCwd(
  queryClient: QueryClient,
  chatId: string,
  worktreeCwd: string,
) {
  patchChatInCache(queryClient, chatId, (chat) =>
    chat.worktree_cwd !== worktreeCwd ? { ...chat, worktree_cwd: worktreeCwd } : chat,
  );
}

export function findMessageInCache(
  queryClient: QueryClient,
  chatId: string,
  messageId: string,
): Message | undefined {
  const data = queryClient.getQueryData<{ pages: PaginatedMessages[] }>(queryKeys.messages(chatId));
  if (!data?.pages) return undefined;
  for (const page of data.pages) {
    const msg = page.items.find((m) => m.id === messageId);
    if (msg) return msg;
  }
  return undefined;
}
