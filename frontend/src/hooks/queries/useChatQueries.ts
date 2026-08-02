import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  UseMutationOptions,
  UseQueryOptions,
  InfiniteData,
  Query,
  QueryClient,
} from '@tanstack/react-query';
import { chatService } from '@/services/chatService';
import { cloudChatService } from '@/services/cloudChatService';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import { isCloudChat } from '@/utils/chatOrigin';
import { useMessageQueueStore } from '@/store/messageQueueStore';
import { useUIStore, type ComposerSelection } from '@/store/uiStore';
import type { Chat, ChatSearchResponse, ContextUsage, CreateChatRequest } from '@/types/chat.types';
import type { PaginatedChats } from '@/types/api.types';
import { logger } from '@/utils/logger';
import { createMutation } from './createMutation';
import { queryKeys } from './queryKeys';

const CHATS_PER_PAGE = 25;
const RECENT_CHATS_PER_PAGE = 100;
const GLOBAL_WORKSPACE_SENTINEL = 'all';

// Global infinite chats: key[3]=GLOBAL_WORKSPACE_SENTINEL, key[4]=null (unpinned).
function isGlobalChatsQuery(query: Query): boolean {
  const key = query.queryKey;
  return key.length >= 5 && key[3] === GLOBAL_WORKSPACE_SENTINEL && key[4] === null;
}

// Cloud sidebar is a separate query local infinite-chats patches don't touch.
function invalidateCloudChats(queryClient: QueryClient, chatId: string) {
  if (isCloudChat(chatId)) {
    queryClient.invalidateQueries({ queryKey: queryKeys.cloudChatsAll });
  }
}

export const useInfiniteChatsQuery = (options?: {
  perPage?: number;
  workspaceId?: string;
  pinned?: boolean;
  enabled?: boolean;
}) => {
  const perPage = options?.perPage ?? CHATS_PER_PAGE;
  const workspaceId = options?.workspaceId;
  const pinned = options?.pinned;

  return useInfiniteQuery({
    queryKey: [
      queryKeys.chats,
      'infinite',
      perPage,
      workspaceId ?? GLOBAL_WORKSPACE_SENTINEL,
      pinned ?? null,
    ] as const,
    queryFn: async ({ pageParam }) => {
      const page = pageParam as number;
      return chatService.listChats({
        page,
        per_page: perPage,
        workspace_id: workspaceId,
        pinned,
      });
    },
    getNextPageParam: (lastPage) => {
      const nextPage = lastPage.page + 1;
      return nextPage <= lastPage.pages ? nextPage : undefined;
    },
    initialPageParam: 1,
    enabled: options?.enabled ?? true,
    gcTime: 1000 * 60 * 1,
    // Snapshot hydrates first paint; always refetch so out-of-band creates surface.
    refetchOnMount: 'always',
  });
};

// Backs the composer's `@` chat mentions: one fetch per staleTime window, filtered
// client-side like files. Includes sub-threads (the top-level-only sidebar doesn't).
export const useRecentChatsQuery = (enabled: boolean) => {
  return useQuery({
    queryKey: queryKeys.chatsRecent,
    queryFn: () =>
      chatService.listChats({
        page: 1,
        per_page: RECENT_CHATS_PER_PAGE,
        include_sub_threads: true,
      }),
    enabled,
    staleTime: 1000 * 60 * 5,
  });
};

export const useSearchChatsQuery = (
  query: string,
  options?: Partial<UseQueryOptions<ChatSearchResponse>>,
) => {
  const trimmed = query.trim();
  return useQuery({
    queryKey: queryKeys.chatsSearch(trimmed),
    queryFn: () => chatService.searchChats(trimmed),
    enabled: trimmed.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    ...options,
  });
};

export const useInfiniteMessagesQuery = (chatId: string | undefined, limit: number = 20) => {
  return useInfiniteQuery({
    queryKey: queryKeys.messages(chatId),
    queryFn: async ({ pageParam }) => {
      return chatService.getMessages(chatId!, {
        cursor: pageParam as string | undefined,
        limit,
      });
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    enabled: !!chatId,
    gcTime: 1000 * 60 * 1,
  });
};

export const useChatQuery = (
  chatId: string | undefined,
  options?: Partial<UseQueryOptions<Chat>>,
) => {
  return useQuery({
    queryKey: queryKeys.chat(chatId),
    queryFn: () => chatService.getChat(chatId!),
    enabled: !!chatId,
    ...options,
  });
};

export const useContextUsageQuery = (
  chatId: string | undefined,
  options?: Partial<UseQueryOptions<ContextUsage>>,
) => {
  return useQuery({
    queryKey: queryKeys.contextUsage(chatId),
    queryFn: () => chatService.getContextUsage(chatId!),
    enabled: !!chatId,
    staleTime: 0,
    ...options,
  });
};

// Shared by create-chat mutation + chat_created SSE. Dedup by id — both paths fire
// for local creates; second-pass invalidations are intentional (don't suppress).
export async function applyCreatedChat(queryClient: QueryClient, newChat: Chat): Promise<void> {
  queryClient.setQueryData(queryKeys.chat(newChat.id), newChat);
  queryClient.invalidateQueries({ queryKey: queryKeys.chatsRecent });

  if (newChat.parent_chat_id) {
    // Sub-thread create bumps parent updated_at (workspace ordering).
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.subThreads(newChat.parent_chat_id) }),
      queryClient.invalidateQueries({ queryKey: [queryKeys.chats, 'infinite'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces }),
    ]);
    return;
  }

  queryClient.setQueriesData<InfiniteData<PaginatedChats>>(
    { queryKey: [queryKeys.chats, 'infinite'], predicate: isGlobalChatsQuery },
    (oldData) => {
      if (!oldData) return oldData;
      if (oldData.pages.some((page) => page.items.some((chat) => chat.id === newChat.id))) {
        return oldData;
      }
      return {
        ...oldData,
        pages: oldData.pages.map((page, index) =>
          index === 0 ? { ...page, items: [newChat, ...page.items], total: page.total + 1 } : page,
        ),
      };
    },
  );

  queryClient.invalidateQueries({
    queryKey: [queryKeys.chats, 'infinite'],
    predicate: (query) => !isGlobalChatsQuery(query),
  });

  queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
}

// Patch single-chat query + every infinite chats list + recent-chats mention list together.
export function patchChatInCache(
  queryClient: QueryClient,
  chatId: string,
  patch: (chat: Chat) => Chat,
) {
  queryClient.setQueryData<Chat>(queryKeys.chat(chatId), (prev) => (prev ? patch(prev) : prev));
  queryClient.setQueriesData<InfiniteData<PaginatedChats>>(
    { queryKey: [queryKeys.chats, 'infinite'] },
    (oldData) => {
      if (!oldData) return oldData;
      return {
        ...oldData,
        pages: oldData.pages.map((page) => ({
          ...page,
          items: page.items.map((chat) => (chat.id === chatId ? patch(chat) : chat)),
        })),
      };
    },
  );
  queryClient.setQueryData<PaginatedChats>(queryKeys.chatsRecent, (oldData) => {
    if (!oldData) return oldData;
    return {
      ...oldData,
      items: oldData.items.map((chat) => (chat.id === chatId ? patch(chat) : chat)),
    };
  });
}

// Optimistic unread clear + server stamp; fire-and-forget (failed stamp resurfaces on refetch).
export async function markChatViewed(queryClient: QueryClient, chatId: string): Promise<void> {
  patchChatInCache(queryClient, chatId, (chat) =>
    chat.unread ? { ...chat, unread: false } : chat,
  );

  try {
    await chatService.markChatViewed(chatId);
  } catch (error) {
    logger.error('Failed to mark chat viewed', 'markChatViewed', error);
    return;
  }
  // Cloud rows live in a separate query the patch above can't reach — refetch
  // them only after the VPS stamp landed, or the refetch would restore the dot.
  invalidateCloudChats(queryClient, chatId);
}

export const useCreateChatMutation = createMutation<Chat, Error, CreateChatRequest>(
  (data) => chatService.createChat(data),
  (queryClient, newChat) => applyCreatedChat(queryClient, newChat),
);

export const useUpdateChatMutation = createMutation<
  Chat,
  Error,
  { chatId: string; updateData: { title?: string } }
>(
  ({ chatId, updateData }) => chatService.updateChat(chatId, updateData),
  (queryClient, updatedChat) => {
    queryClient.setQueryData(queryKeys.chat(updatedChat.id), updatedChat);

    queryClient.setQueriesData<InfiniteData<PaginatedChats>>(
      { queryKey: [queryKeys.chats, 'infinite'] },
      (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          pages: oldData.pages.map((page) => ({
            ...page,
            items: page.items.map((chat) =>
              chat.id === updatedChat.id
                ? { ...updatedChat, sub_thread_count: chat.sub_thread_count }
                : chat,
            ),
          })),
        };
      },
    );

    // Patch + invalidate, not either alone: the patch renames cached entries instantly,
    // the refetch fixes membership — updated_at bumps can pull in an uncached chat.
    queryClient.setQueryData<PaginatedChats>(queryKeys.chatsRecent, (oldData) => {
      if (!oldData) return oldData;
      return {
        ...oldData,
        items: oldData.items.map((chat) =>
          chat.id === updatedChat.id
            ? { ...updatedChat, sub_thread_count: chat.sub_thread_count }
            : chat,
        ),
      };
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.chatsRecent });

    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
    queryClient.invalidateQueries({ queryKey: queryKeys.chatsSearchAll });
    invalidateCloudChats(queryClient, updatedChat.id);

    if (updatedChat.parent_chat_id) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.subThreads(updatedChat.parent_chat_id),
      });
    }
  },
);

export const usePinChatMutation = createMutation<Chat, Error, { chatId: string; pinned: boolean }>(
  ({ chatId, pinned }) => (pinned ? chatService.pinChat(chatId) : chatService.unpinChat(chatId)),
  (queryClient, updatedChat) => {
    queryClient.setQueryData(queryKeys.chat(updatedChat.id), updatedChat);

    // Pin changes sort (pinned_at/updated_at) and may move chats into/out of cached pages.
    queryClient.invalidateQueries({
      queryKey: [queryKeys.chats, 'infinite'],
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
    invalidateCloudChats(queryClient, updatedChat.id);
  },
);

export const useDeleteChatMutation = createMutation<void, Error, string>(
  (chatId) => chatService.deleteChat(chatId),
  (queryClient, _data, chatId) => {
    queryClient.setQueriesData<InfiniteData<PaginatedChats>>(
      { queryKey: [queryKeys.chats, 'infinite'] },
      (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          pages: oldData.pages.map((page) => ({
            ...page,
            items: page.items.filter((chat) => chat.id !== chatId),
            total: Math.max(0, page.total - 1),
          })),
        };
      },
    );

    // One pass: find parent if sub-thread, clean child caches if deleting a parent.
    let parentId = queryClient.getQueryData<Chat>(queryKeys.chat(chatId))?.parent_chat_id;
    const allCachedEntries = queryClient.getQueriesData<Chat | Chat[]>({ queryKey: ['chat'] });
    for (const [key, data] of allCachedEntries) {
      if (!parentId && Array.isArray(data) && data.some((sub) => sub.id === chatId)) {
        parentId = key[1] as string;
      }
      if (!Array.isArray(data) && data?.parent_chat_id === chatId) {
        queryClient.removeQueries({ queryKey: queryKeys.chat(data.id) });
        queryClient.removeQueries({ queryKey: queryKeys.messages(data.id) });
        queryClient.removeQueries({ queryKey: queryKeys.contextUsage(data.id) });
        useMessageQueueStore.getState().cleanupChat(data.id);
        useUIStore.getState().cleanupChat(data.id);
      }
    }

    if (parentId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.subThreads(parentId) });
    }

    queryClient.removeQueries({ queryKey: queryKeys.chat(chatId) });
    queryClient.removeQueries({ queryKey: queryKeys.messages(chatId) });
    queryClient.removeQueries({ queryKey: queryKeys.contextUsage(chatId) });
    queryClient.removeQueries({ queryKey: queryKeys.subThreads(chatId) });
    queryClient.invalidateQueries({ queryKey: [queryKeys.chats, 'infinite'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.chatsRecent });
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
    queryClient.invalidateQueries({ queryKey: queryKeys.chatsSearchAll });
    invalidateCloudChats(queryClient, chatId);
    useMessageQueueStore.getState().cleanupChat(chatId);
    useUIStore.getState().cleanupChat(chatId);
  },
);

// Wipe both backends; drop successful side's caches even if the other fails (partial wipe is real).
export const useDeleteAllChatsMutation = () => {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      const wipes = [
        chatService.deleteAllChats().then(() => {
          // Prefix ['chats'] also clears chatsSearch.
          queryClient.removeQueries({ queryKey: [queryKeys.chats] });
          queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
        }),
      ];
      const { cloudUrl, connectedEmail } = useCloudSettingsStore.getState();
      if (connectedEmail) {
        wipes.push(
          cloudChatService.deleteAllChats().then(() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.cloudChatsAll });
            queryClient.invalidateQueries({
              queryKey: queryKeys.cloudWorkspaces(cloudUrl, connectedEmail),
            });
          }),
        );
      }
      const results = await Promise.allSettled(wipes);
      if (results.some((result) => result.status === 'fulfilled')) {
        useUIStore.getState().cleanupAllChats();
      }
      const failed = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failed) {
        throw failed.reason instanceof Error
          ? failed.reason
          : new Error('Failed to delete all chats');
      }
    },
  });
};

interface EnhancePromptParams {
  prompt: string;
  modelId: string;
}

export const useSubThreadsQuery = (chatId: string | undefined) => {
  return useQuery({
    queryKey: queryKeys.subThreads(chatId),
    queryFn: () => chatService.getSubThreads(chatId!),
    enabled: !!chatId,
  });
};

// parentChatId is captured in the closure — safe because the dialog closes
// on create (onClose + navigate), so the parentChatId can't go stale.
export const useCreateSubThreadMutation = (parentChatId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateChatRequest) => chatService.createChat(data),
    onSuccess: async (newChat) => {
      queryClient.setQueryData(queryKeys.chat(newChat.id), newChat);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.subThreads(parentChatId) }),
        queryClient.invalidateQueries({ queryKey: [queryKeys.chats, 'infinite'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces }),
      ]);
      // Cloud parent isn't in local infinite query — refresh so sub_thread_count unlocks expand.
      invalidateCloudChats(queryClient, parentChatId);
    },
  });
};

export const useGenerateChatTitleMutation = () => {
  return useMutation({
    mutationFn: (chatId: string) => chatService.generateChatTitle(chatId),
  });
};

export const useEnhancePromptMutation = (
  options?: UseMutationOptions<string, Error, EnhancePromptParams>,
) => {
  return useMutation({
    mutationFn: ({ prompt, modelId }: EnhancePromptParams) =>
      chatService.enhancePrompt(prompt, modelId),
    ...options,
  });
};

interface AskAboutCodeParams {
  chatId: string;
  selection: ComposerSelection;
  question: string;
  modelId: string;
}

export const useAskAboutCodeMutation = () => {
  return useMutation({
    mutationFn: ({ chatId, selection, question, modelId }: AskAboutCodeParams) =>
      chatService.askAboutCode(chatId, selection, question, modelId),
  });
};
