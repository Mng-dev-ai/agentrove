import { create } from 'zustand';
import type { ElicitationRequest } from '@/types/chat.types';

interface ElicitationState {
  // One slot per chat — the backend serializes elicitations within a turn.
  pendingRequests: Map<string, ElicitationRequest>;
  setElicitationRequest: (chatId: string, request: ElicitationRequest) => void;
  clearElicitationRequest: (chatId: string, requestId: string) => void;
}

export const useElicitationStore = create<ElicitationState>((set, get) => ({
  pendingRequests: new Map<string, ElicitationRequest>(),

  setElicitationRequest: (chatId: string, request: ElicitationRequest) => {
    // Ignore SSE replays of the form already on screen so typed answers survive.
    if (get().pendingRequests.get(chatId)?.request_id === request.request_id) return;
    const nextRequests = new Map(get().pendingRequests);
    nextRequests.set(chatId, request);
    set({ pendingRequests: nextRequests });
  },

  clearElicitationRequest: (chatId: string, requestId: string) => {
    set((state) => {
      if (state.pendingRequests.get(chatId)?.request_id !== requestId) return state;
      const nextRequests = new Map(state.pendingRequests);
      nextRequests.delete(chatId);
      return { pendingRequests: nextRequests };
    });
  },
}));
