import { create } from 'zustand';
import type { PermissionRequest } from '@/types/chat.types';

interface PermissionState {
  // chatId -> FIFO queue of pending requests. Each chat can have several
  // permission requests in flight at once (the agent may emit a batch of tool
  // calls), so we keep a queue and surface them to the UI one at a time. Keying
  // by a single request per chat would drop all but the last, leaving the
  // backend blocked forever on the unanswered ones.
  pendingRequests: Map<string, PermissionRequest[]>;
  // Returns true if the request was newly enqueued, false if it was a duplicate
  // that got deduped — callers use this to gate one-time side effects (e.g.
  // notifications) without re-scanning the queue themselves.
  enqueuePermissionRequest: (chatId: string, request: PermissionRequest) => boolean;
  resolvePermissionRequest: (chatId: string, requestId: string) => void;
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  pendingRequests: new Map<string, PermissionRequest[]>(),

  enqueuePermissionRequest: (chatId: string, request: PermissionRequest) => {
    const queue = get().pendingRequests.get(chatId) ?? [];
    // Dedupe by request_id so duplicate SSE envelopes (e.g. after a
    // reconnect) don't enqueue the same request twice.
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
