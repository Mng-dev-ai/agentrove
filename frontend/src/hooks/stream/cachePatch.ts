import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { patchChatInCache } from '@/hooks/queries/useChatQueries';
import type { ChatEvent, Message } from '@/types/chat.types';
import type { PaginatedMessages } from '@/types/api.types';
import { createTurnMessages, insertMessagesById } from '@/hooks/stream/messageUpdates';

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

export function insertMessagesInCache(
  queryClient: QueryClient,
  chatId: string,
  messages: Message[],
): void {
  const query = queryClient
    .getQueryCache()
    .find({ queryKey: queryKeys.messages(chatId), exact: true });
  if (query?.state.fetchStatus === 'fetching') {
    void query.promise?.then(
      () => insertMessagesInCache(queryClient, chatId, messages),
      () => undefined,
    );
  }
  queryClient.setQueryData(
    queryKeys.messages(chatId),
    (oldData: { pages: PaginatedMessages[]; pageParams: unknown[] } | undefined) => {
      if (!oldData?.pages.length) return oldData;
      const ids = new Set(
        oldData.pages.slice(1).flatMap((page) => page.items.map((message) => message.id)),
      );
      const current = [...oldData.pages[0].items].reverse();
      const merged = insertMessagesById(
        current,
        messages.filter((message) => !ids.has(message.id)),
      );
      if (merged === current) return oldData;
      const items = merged.reverse();
      return {
        ...oldData,
        pages: oldData.pages.map((page, index) => (index === 0 ? { ...page, items } : page)),
      };
    },
  );
}

export function insertStartedTurnInCache(
  queryClient: QueryClient,
  event: Extract<ChatEvent, { kind: 'stream_started' }>,
): void {
  patchChatInCache(queryClient, event.chat_id, (chat) => ({
    ...chat,
    last_model_id: event.model_id,
    ...(event.thinking_mode !== undefined && { last_thinking_mode: event.thinking_mode }),
    ...(event.permission_mode !== undefined && { last_permission_mode: event.permission_mode }),
    ...(event.selected_persona_name !== undefined && {
      last_persona_name: event.selected_persona_name,
    }),
  }));
  if (!event.user_message_id || event.content === undefined) return;
  insertMessagesInCache(
    queryClient,
    event.chat_id,
    createTurnMessages(event.chat_id, {
      userMessageId: event.user_message_id,
      assistantMessageId: event.message_id,
      content: event.content,
      attachments: event.attachments ?? [],
      modelId: event.model_id,
      checkpointId: event.checkpoint_id,
    }),
  );
}
