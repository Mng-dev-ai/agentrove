import { create } from 'zustand';
import type { PermissionRequest } from '@/types/chat.types';

interface PermissionState {
  // FIFO per chat — agents may batch tool calls; a single slot would drop earlier ones.
  pendingRequests: Map<string, PermissionRequest[]>;
  // true if newly enqueued (gate one-time side effects like notifications).
  enqueuePermissionRequest: (chatId: string, request: PermissionRequest) => boolean;
  resolvePermissionRequest: (chatId: string, requestId: string) => void;
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  pendingRequests: new Map<string, PermissionRequest[]>(),

  enqueuePermissionRequest: (chatId: string, request: PermissionRequest) => {
    const queue = get().pendingRequests.get(chatId) ?? [];
    // Dedupe SSE replays after reconnect.
    if (queue.some((r) => r.request_id === request.request_id)) {
      return false;
    }
    const nextRequests = new Map(get().pendingRequests);
    nextRequests.set(chatId, [...queue, request]);
    set({ pendingRequests: nextRequests });
    return true;
  },

  resolvePermissionRequest: (chatId: string, requestId: string) => {
    set((state) => {
      const queue = state.pendingRequests.get(chatId);
      if (!queue) return state;
      const nextQueue = queue.filter((r) => r.request_id !== requestId);
      if (nextQueue.length === queue.length) return state;
      const nextRequests = new Map(state.pendingRequests);
      if (nextQueue.length === 0) {
        nextRequests.delete(chatId);
      } else {
        nextRequests.set(chatId, nextQueue);
      }
      return { pendingRequests: nextRequests };
    });
  },
}));
