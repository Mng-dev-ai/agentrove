import { create } from 'zustand';
import type { PermissionRequest } from '@/types/chat.types';
import { isPermissionResolved } from '@/utils/permissionStorage';

interface PermissionState {
  // FIFO per chat — agents may batch tool calls; a single slot would drop earlier ones.
  pendingRequests: Map<string, PermissionRequest[]>;
  // true if newly enqueued (gate one-time side effects like notifications).
  enqueuePermissionRequest: (chatId: string, request: PermissionRequest) => boolean;
  resolvePermissionRequest: (chatId: string, requestId: string) => void;
  clearPermissionRequests: (chatId: string) => void;
  // Server truth from GET /chats/{id}/status — event replay can miss pending prompts.
  reconcilePermissionRequests: (
    chatId: string,
    requests: PermissionRequest[],
    knownIds: Set<string>,
  ) => void;
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

  clearPermissionRequests: (chatId: string) => {
    set((state) => {
      if (!state.pendingRequests.has(chatId)) return state;
      const nextRequests = new Map(state.pendingRequests);
      nextRequests.delete(chatId);
      return { pendingRequests: nextRequests };
    });
  },

  reconcilePermissionRequests: (
    chatId: string,
    requests: PermissionRequest[],
    knownIds: Set<string>,
  ) => {
    set((state) => {
      const queue = state.pendingRequests.get(chatId) ?? [];
      const serverIds = new Set(requests.map((r) => r.request_id));
      const kept = queue.filter((r) => serverIds.has(r.request_id) || !knownIds.has(r.request_id));
      const keptIds = new Set(kept.map((r) => r.request_id));
      // A prompt answered while the status request was in flight is still listed.
      const added = requests.filter(
        (r) => !keptIds.has(r.request_id) && !isPermissionResolved(chatId, r.seq),
      );
      const nextQueue = [...kept, ...added];
      if (nextQueue.length === queue.length && nextQueue.every((r, i) => r === queue[i])) {
        return state;
      }
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
