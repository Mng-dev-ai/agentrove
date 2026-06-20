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
import { isCloudChat } from '@/utils/chatOrigin';
import { useMessageQueueStore } from '@/store/messageQueueStore';
import type { Chat, ChatSearchResponse, ContextUsage, CreateChatRequest } from '@/types/chat.types';
import type { ChangedFilesData, FileDiffData } from '@/types/sandbox.types';
import type { PaginatedChats } from '@/types/api.types';
import { createMutation } from './createMutation';
import { queryKeys } from './queryKeys';

const CHATS_PER_PAGE = 25;
const GLOBAL_WORKSPACE_SENTINEL = 'all';

// Matches the global (non-workspace-scoped, unpinned) infinite chats query.
// Key shape: [chats, 'infinite', perPage, workspaceId, pinned]
//   — index 3 = GLOBAL_WORKSPACE_SENTINEL for unscoped queries
//   — index 4 = null for unpinned (true for pinned-only)
function isGlobalChatsQuery(query: Query): boolean {
  const key = query.queryKey;
  return key.length >= 5 && key[3] === GLOBAL_WORKSPACE_SENTINEL && key[4] === null;
}

// Cloud chats live in a separate query the local infinite-chats cache patches don't touch.
// Centralized so a new chat mutation can't silently forget to refresh the cloud sidebar.
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
      return chatService.getMessages(chatId, {
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
    queryFn: () => chatService.getChat(chatId),
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
    queryFn: () => chatService.getContextUsage(chatId),
    enabled: !!chatId,
    staleTime: 0,
    ...options,
  });
};

export const useMessageChangesQuery = (
  chatId: string | undefined,
  messageId: string | undefined,
  options?: Partial<UseQueryOptions<ChangedFilesData>>,
) => {
  return useQuery({
    queryKey: queryKeys.messageChanges(chatId, messageId),
    queryFn: () => chatService.getMessageChanges(chatId, messageId!),
    enabled: !!messageId,
    staleTime: Infinity,
    ...options,
  });
};

export const useMessageFileDiffQuery = (
  chatId: string | undefined,
  messageId: string | undefined,
  path: string | undefined,
  options?: Partial<UseQueryOptions<FileDiffData>>,
) => {
  return useQuery({
    queryKey: queryKeys.messageFileDiff(chatId, messageId, path),
    queryFn: () => chatService.getMessageFileDiff(chatId, messageId!, path!),
    enabled: !!messageId && !!path,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 5,
    ...options,
  });
};

export const useCreateChatMutation = createMutation<Chat, Error, CreateChatRequest>(
  (data) => chatService.createChat(data),
  async (queryClient, newChat) => {
    queryClient.setQueryData(queryKeys.chat(newChat.id), newChat);

    if (newChat.parent_chat_id) {
      await queryClient.invalidateQueries({ queryKey: [queryKeys.chats, 'infinite'] });
      return;
    }

    queryClient.setQueriesData<InfiniteData<PaginatedChats>>(
      { queryKey: [queryKeys.chats, 'infinite'], predicate: isGlobalChatsQuery },
      (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          pages: oldData.pages.map((page, index) =>
            index === 0
              ? { ...page, items: [newChat, ...page.items], total: page.total + 1 }
              : page,
          ),
        };
      },
    );

    queryClient.invalidateQueries({
      queryKey: [queryKeys.chats, 'infinite'],
      predicate: (query) => !isGlobalChatsQuery(query),
    });

    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
  },
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

    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
    // Search results embed the chat title, so a rename leaves a stale title
    // visible until the search query is refetched.
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

    // Invalidate all chat caches: global (pinned section needs re-sort and may need
    // to include a chat that wasn't in the cache) and workspace-scoped (pinning/unpinning
    // changes pinned_at and updated_at, which affects backend sort order).
    // Also invalidate workspaces since last_chat_at may have changed.
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

    // Single scan of all ['chat', ...] entries to:
    // 1. Find the parent of the deleted chat (if it's a sub-thread)
    // 2. Clean up caches for child sub-threads (if deleting a parent)
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
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
    queryClient.invalidateQueries({ queryKey: queryKeys.chatsSearchAll });
    invalidateCloudChats(queryClient, chatId);
    useMessageQueueStore.getState().cleanupChat(chatId);
  },
);

export const useDeleteAllChatsMutation = createMutation<void, Error, void>(
  () => chatService.deleteAllChats(),
  (queryClient) => {
    // removeQueries on the prefix ['chats'] also clears chatsSearch entries.
    queryClient.removeQueries({ queryKey: [queryKeys.chats] });
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
  },
);

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
      // A cloud parent lives in the cloud sidebar list, not the local infinite query —
      // refetch it so the parent's bumped sub_thread_count unlocks the expand control.
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
