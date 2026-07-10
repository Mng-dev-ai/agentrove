import { create } from 'zustand';
import type { LocalQueuedMessage } from '@/types/queue.types';
import { queueService } from '@/services/queueService';
import { DEFAULT_PERSONA, DEFAULT_PERMISSION_MODE } from '@/store/chatSettingsStore';
import type { PermissionMode } from '@/store/chatSettingsStore';

export const EMPTY_QUEUE: LocalQueuedMessage[] = [];

interface MessageQueueState {
  queues: Map<string, LocalQueuedMessage[]>;
  queueMessage: (
    chatId: string,
    content: string,
    modelId: string,
    permissionMode?: PermissionMode,
    thinkingMode?: string | null,
    worktree?: boolean,
    selectedPersonaName?: string,
    files?: File[],
  ) => Promise<string>;
  updateQueuedMessage: (chatId: string, messageId: string, content: string) => Promise<void>;
  removeMessage: (chatId: string, messageId: string) => Promise<void>;
  getQueue: (chatId: string) => LocalQueuedMessage[];
  sendNow: (chatId: string, messageId: string) => Promise<boolean>;
  clearQueue: (chatId: string) => void;
  fetchQueue: (chatId: string) => Promise<void>;
  removeLocalOnly: (chatId: string, messageId: string) => void;
  cleanupChat: (chatId: string) => void;
}

// Optimistic message queue: messages are added locally with a temp ID, then
// synced to the server. If the server returns a real ID, the temp ID is swapped
// in-place. Network errors leave the message as unsynced. fetchQueue merges
// server state with any unsynced locals so nothing is lost across page refreshes.
export const useMessageQueueStore = create<MessageQueueState>((set, get) => ({
  queues: new Map<string, LocalQueuedMessage[]>(),

  queueMessage: async (
    chatId: string,
    content: string,
    modelId: string,
    permissionMode: PermissionMode = DEFAULT_PERMISSION_MODE,
    thinkingMode: string | null = null,
    worktree: boolean = false,
    selectedPersonaName: string = DEFAULT_PERSONA,
    files?: File[],
  ): Promise<string> => {
    const currentQueue = get().queues.get(chatId) || [];
    const tempId = crypto.randomUUID();
    const tempMessage: LocalQueuedMessage = {
      id: tempId,
      content,
      model_id: modelId,
      files,
      permissionMode,
      thinkingMode,
      worktree,
      selectedPersonaName,
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
      const result = await queueService.queueMessage(
        chatId,
        content,
        modelId,
        permissionMode,
        thinkingMode,
        worktree,
        selectedPersonaName,
        files,
      );

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
      const isNetworkError =
        error instanceof TypeError || (error instanceof Error && error.message.includes('network'));

      if (!isNetworkError) {
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
        await queueService.updateQueuedMessage(chatId, messageId, trimmedContent);
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
        await queueService.deleteQueuedMessage(chatId, messageId);
      } catch (error) {
        console.error('Failed to sync message delete:', error);
      }
    }
  },

  // Asks the backend to immediately process this queued message instead of
  // waiting for the stream to finish. Sets a 30s timeout guard to reset the
  // sendingNow flag in case the request hangs without a response.
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
      await queueService.sendNow(chatId, messageId);
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

  // Fetches the server-side queue and merges it with any unsynced local messages.
  // Server messages replace their local counterparts; unsynced locals are appended.
  fetchQueue: async (chatId: string) => {
    try {
      const serverMessages = await queueService.getQueue(chatId);

      set((state) => {
        const nextQueues = new Map(state.queues);
        const existingQueue = nextQueues.get(chatId) || [];

        const serverIds = new Set(serverMessages.map((m) => m.id));
        const pendingMessages = existingQueue.filter((m) => !m.synced && !serverIds.has(m.id));

        const syncedMessages: LocalQueuedMessage[] = serverMessages.map((msg) => ({
          id: msg.id,
          content: msg.content,
          model_id: msg.model_id,
          attachments: msg.attachments,
          permissionMode: msg.permission_mode,
          thinkingMode: msg.thinking_mode ?? null,
          worktree: msg.worktree,
          selectedPersonaName: msg.selected_persona_name,
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
