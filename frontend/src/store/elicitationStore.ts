import { create } from 'zustand';
import type { ElicitationRequest } from '@/types/chat.types';

interface ElicitationState {
  // FIFO per chat — MCP-server elicitations are not serialized, so a single slot
  // would drop earlier forms and leave their agent requests blocked forever.
  pendingRequests: Map<string, ElicitationRequest[]>;
  enqueueElicitationRequest: (chatId: string, request: ElicitationRequest) => void;
  resolveElicitationRequest: (chatId: string, requestId: string) => void;
  // Server truth from GET /chats/{id}/status — event replay can miss pending forms.
  reconcileElicitationRequests: (chatId: string, requests: ElicitationRequest[]) => void;
}

function writeQueue(
  requests: Map<string, ElicitationRequest[]>,
  chatId: string,
  queue: ElicitationRequest[],
): Map<string, ElicitationRequest[]> {
  const next = new Map(requests);
  if (queue.length === 0) {
    next.delete(chatId);
  } else {
    next.set(chatId, queue);
  }
  return next;
}

export const useElicitationStore = create<ElicitationState>((set, get) => ({
  pendingRequests: new Map<string, ElicitationRequest[]>(),

  enqueueElicitationRequest: (chatId: string, request: ElicitationRequest) => {
    const queue = get().pendingRequests.get(chatId) ?? [];
    // Dedupe SSE replays — re-adding the displayed form would drop typed answers.
    if (queue.some((r) => r.request_id === request.request_id)) return;
    set({ pendingRequests: writeQueue(get().pendingRequests, chatId, [...queue, request]) });
  },

  resolveElicitationRequest: (chatId: string, requestId: string) => {
    set((state) => {
      const queue = state.pendingRequests.get(chatId);
      if (!queue) return state;
      const nextQueue = queue.filter((r) => r.request_id !== requestId);
      if (nextQueue.length === queue.length) return state;
      return { pendingRequests: writeQueue(state.pendingRequests, chatId, nextQueue) };
    });
  },

  reconcileElicitationRequests: (chatId: string, requests: ElicitationRequest[]) => {
    set((state) => {
      const queue = state.pendingRequests.get(chatId) ?? [];
      const serverIds = new Set(requests.map((r) => r.request_id));
      // Keep the local entries the server still lists, in queue order, by identity —
      // the head must stay the same object so unsubmitted answers survive.
      const kept = queue.filter((r) => serverIds.has(r.request_id));
      const keptIds = new Set(kept.map((r) => r.request_id));
      const added = requests.filter((r) => !keptIds.has(r.request_id));
      const nextQueue = [...kept, ...added];

      if (nextQueue.length === queue.length && nextQueue.every((r, i) => r === queue[i])) {
        return state;
      }
      return { pendingRequests: writeQueue(state.pendingRequests, chatId, nextQueue) };
    });
  },
}));
