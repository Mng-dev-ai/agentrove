import { create } from 'zustand';
import type { Chat } from '@/types/chat.types';
import type { UIActions, UIState } from '@/types/ui.types';

type ChatStoreType = Pick<UIState, 'currentChat' | 'attachedFilesByChat'> &
  Pick<
    UIActions,
    | 'setCurrentChat'
    | 'setAttachedFilesForChat'
    | 'clearAttachedFilesForChat'
    | 'promoteAttachedFiles'
  >;

// Per-chat one-shot attachment slot. Files attached pre-send (landing page or
// the "open in split" affordance) live here keyed by chatId; the orchestrator
// consumes and clears its slot after the first message ships.
export const useChatStore = create<ChatStoreType>((set) => ({
  currentChat: null,
  attachedFilesByChat: {},
  setCurrentChat: (chat: Chat | null) => set({ currentChat: chat }),
  setAttachedFilesForChat: (chatId, files) =>
    set((state) => {
      if (state.attachedFilesByChat[chatId] === files) return state;
      return { attachedFilesByChat: { ...state.attachedFilesByChat, [chatId]: files } };
    }),
  clearAttachedFilesForChat: (chatId) =>
    set((state) => {
      if (!(chatId in state.attachedFilesByChat)) return state;
      const next = { ...state.attachedFilesByChat };
      delete next[chatId];
      return { attachedFilesByChat: next };
    }),
  promoteAttachedFiles: (fromChatId, toChatId) =>
    set((state) => {
      const files = state.attachedFilesByChat[fromChatId];
      if (!files) return state;
      const next = { ...state.attachedFilesByChat, [toChatId]: files };
      delete next[fromChatId];
      return { attachedFilesByChat: next };
    }),
}));
