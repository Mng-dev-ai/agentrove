import { create } from 'zustand';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { useStreamStore } from '@/store/streamStore';
import type {
  LocalQueuedMessage,
  QueueAddResponse,
  QueuedItem,
  QueueMessageOptions,
} from '@/types/queue.types';
import { channelService } from '@/services/channelService';
import { queueService } from '@/services/queueService';
import { NetworkError } from '@/types/errors.types';

export const EMPTY_QUEUE: LocalQueuedMessage[] = [];

// Server API behind a queue store; AddArgs are the per-target arguments after content.
interface QueueApi<AddArgs extends unknown[]> {
  queueMessage: (queueId: string, content: string, ...args: AddArgs) => Promise<QueueAddResponse>;
  getQueue: (queueId: string) => Promise<QueuedItem[]>;
  updateQueuedMessage: (queueId: string, messageId: string, content: string) => Promise<unknown>;
  deleteQueuedMessage: (queueId: string, messageId: string) => Promise<void>;
  sendNow: (queueId: string, messageId: string) => Promise<void>;
  filesOf: (...args: AddArgs) => File[] | undefined;
}

interface MessageQueueState<AddArgs extends unknown[]> {
  queues: Map<string, LocalQueuedMessage[]>;
  queueMessage: (chatId: string, content: string, ...args: AddArgs) => Promise<string>;
  updateQueuedMessage: (chatId: string, messageId: string, content: string) => Promise<void>;
  removeMessage: (chatId: string, messageId: string) => Promise<void>;
  getQueue: (chatId: string) => LocalQueuedMessage[];
  sendNow: (chatId: string, messageId: string) => Promise<boolean>;
  clearQueue: (chatId: string) => void;
  fetchQueue: (chatId: string) => Promise<void>;
  removeLocalOnly: (chatId: string, messageId: string) => void;
  cleanupChat: (chatId: string) => void;
}

// Optimistic queue: temp IDs swap in-place on sync; network errors stay unsynced.
// fetchQueue merges server state with unsynced locals across refreshes.
const createQueueStore = <AddArgs extends unknown[]>(api: QueueApi<AddArgs>) =>
  create<MessageQueueState<AddArgs>>((set, get) => ({
    queues: new Map<string, LocalQueuedMessage[]>(),

    queueMessage: async (chatId: string, content: string, ...args: AddArgs): Promise<string> => {
      const currentQueue = get().queues.get(chatId) || [];
      const tempId = crypto.randomUUID();
      const tempMessage: LocalQueuedMessage = {
        id: tempId,
        content,
        files: api.filesOf(...args),
        queuedAt: Date.now(),
        synced: false,
        sendingNow: false,
      };

      set((state) => {
        const nextQueues = new Map(state.queues);
        nextQueues.set(chatId, [...currentQueue, tempMessage]);
        return { queues: nextQueues };
      });

      try {
        const result = await api.queueMessage(chatId, content, ...args);

        set((state) => {
          const nextQueues = new Map(state.queues);
          const queue = nextQueues.get(chatId) || [];
          const updatedQueue = queue.map((msg) =>
            msg.id === tempId ? { ...msg, id: result.id, synced: true } : msg,
          );
          nextQueues.set(chatId, updatedQueue);
          return { queues: nextQueues };
        });

        return result.id;
      } catch (error) {
        if (!(error instanceof NetworkError)) {
          get().removeLocalOnly(chatId, tempId);
          throw error;
        }

        return tempId;
      }
    },

    updateQueuedMessage: async (chatId: string, messageId: string, content: string) => {
      const trimmedContent = content.trim();
      const currentQueue = get().queues.get(chatId) || [];
      const message = currentQueue.find((m) => m.id === messageId);

      if (!message) {
        return;
      }

      if (!trimmedContent) {
        await get().removeMessage(chatId, messageId);
        return;
      }

      set((state) => {
        const nextQueues = new Map(state.queues);
        const queue = nextQueues.get(chatId) || [];
        const updatedQueue = queue.map((msg) =>
          msg.id === messageId ? { ...msg, content: trimmedContent } : msg,
        );
        nextQueues.set(chatId, updatedQueue);
        return { queues: nextQueues };
      });

      if (message.synced) {
        try {
          await api.updateQueuedMessage(chatId, messageId, trimmedContent);
        } catch (error) {
          console.error('Failed to sync message update:', error);
        }
      }
    },

    removeMessage: async (chatId: string, messageId: string) => {
      const currentQueue = get().queues.get(chatId) || [];
      const message = currentQueue.find((m) => m.id === messageId);

      set((state) => {
        const nextQueues = new Map(state.queues);
        const queue = nextQueues.get(chatId) || [];
        const filtered = queue.filter((msg) => msg.id !== messageId);
        if (filtered.length === 0) {
          nextQueues.delete(chatId);
        } else {
          nextQueues.set(chatId, filtered);
        }
        return { queues: nextQueues };
      });

      if (message?.synced) {
        try {
          await api.deleteQueuedMessage(chatId, messageId);
        } catch (error) {
          console.error('Failed to sync message delete:', error);
        }
      }
    },

    // Process now instead of waiting for the stream; 30s guard resets sendingNow.
    sendNow: async (chatId: string, messageId: string): Promise<boolean> => {
      const queue = get().queues.get(chatId) || [];
      const message = queue.find((m) => m.id === messageId);
      if (!message?.synced) return false;

      const resetSendingNow = () => {
        set((state) => {
          const nextQueues = new Map(state.queues);
          const currentQueue = nextQueues.get(chatId) || [];
          nextQueues.set(
            chatId,
            currentQueue.map((msg) => (msg.id === messageId ? { ...msg, sendingNow: false } : msg)),
          );
          return { queues: nextQueues };
        });
      };

      set((state) => {
        const nextQueues = new Map(state.queues);
        const currentQueue = nextQueues.get(chatId) || [];
        nextQueues.set(
          chatId,
          currentQueue.map((msg) => (msg.id === messageId ? { ...msg, sendingNow: true } : msg)),
        );
        return { queues: nextQueues };
      });

      const timeout = window.setTimeout(resetSendingNow, 30_000);

      try {
        await api.sendNow(chatId, messageId);
        clearTimeout(timeout);
        return true;
      } catch (error) {
        console.error('Failed to send now:', error);
        clearTimeout(timeout);
        resetSendingNow();
        return false;
      }
    },

    removeLocalOnly: (chatId: string, messageId: string) => {
      set((state) => {
        const nextQueues = new Map(state.queues);
        const currentQueue = nextQueues.get(chatId) || [];
        const filteredQueue = currentQueue.filter((msg) => msg.id !== messageId);

        if (filteredQueue.length === 0) {
          nextQueues.delete(chatId);
        } else {
          nextQueues.set(chatId, filteredQueue);
        }

        return { queues: nextQueues };
      });
    },

    getQueue: (chatId: string) => {
      return get().queues.get(chatId) ?? EMPTY_QUEUE;
    },

    clearQueue: (chatId: string) => {
      set((state) => {
        const nextQueues = new Map(state.queues);
        nextQueues.delete(chatId);
        return { queues: nextQueues };
      });
    },

    cleanupChat: (chatId: string) => {
      set((state) => {
        const nextQueues = new Map(state.queues);
        nextQueues.delete(chatId);
        return { queues: nextQueues };
      });
    },

    // Server messages win; unsynced locals without a server counterpart are kept.
    fetchQueue: async (chatId: string) => {
      try {
        const serverMessages = await api.getQueue(chatId);

        set((state) => {
          const nextQueues = new Map(state.queues);
          const existingQueue = nextQueues.get(chatId) || [];

          const serverIds = new Set(serverMessages.map((m) => m.id));
          const pendingMessages = existingQueue.filter((m) => !m.synced && !serverIds.has(m.id));

          const syncedMessages: LocalQueuedMessage[] = serverMessages.map((msg) => ({
            id: msg.id,
            content: msg.content,
            attachments: msg.attachments,
            queuedAt: new Date(msg.queued_at).getTime(),
            synced: true,
            sendingNow: false,
          }));

          const merged = [...syncedMessages, ...pendingMessages];
          if (merged.length > 0) {
            nextQueues.set(chatId, merged);
          } else {
            nextQueues.delete(chatId);
          }

          return { queues: nextQueues };
        });
      } catch (error) {
        console.error('Failed to fetch queue:', error);
      }
    },
  }));

export const useMessageQueueStore = createQueueStore<
  [modelId: string, options?: QueueMessageOptions]
>({
  ...queueService,
  filesOf: (_modelId, options) => options?.files,
});

export const useChannelQueueStore = createQueueStore<[files: File[]]>({
  queueMessage: channelService.queueMessage,
  getQueue: channelService.getQueue,
  updateQueuedMessage: channelService.updateQueuedMessage,
  deleteQueuedMessage: channelService.deleteQueuedMessage,
  sendNow: channelService.sendQueuedNow,
  filesOf: (files) => files,
});

export async function sendQueuedMessageNow(chatId: string, messageId: string) {
  const queue = useMessageQueueStore.getState();
  const success = await queue.sendNow(chatId, messageId);
  if (success && !useStreamStore.getState().getStreamByChat(chatId)) {
    queue.removeLocalOnly(chatId, messageId);
    await queryClient.invalidateQueries({ queryKey: queryKeys.messages(chatId) });
  }
}

export async function sendChannelQueuedMessageNow(channelId: string, messageId: string) {
  const queue = useChannelQueueStore.getState();
  if (await queue.sendNow(channelId, messageId)) queue.removeLocalOnly(channelId, messageId);
}
