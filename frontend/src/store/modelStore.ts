import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ModelSelectionState } from '@/types/ui.types';

export const DEFAULT_MODEL_KEY = '__default__';

export const useModelStore = create<ModelSelectionState>()(
  persist(
    (set, get) => ({
      modelByChat: {},
      favoriteModelIds: [],
      selectModel: (chatId: string, modelId: string) => {
        const trimmedId = modelId?.trim();
        if (trimmedId && get().modelByChat[chatId] !== trimmedId) {
          set((state) => ({
            modelByChat: { ...state.modelByChat, [chatId]: trimmedId },
          }));
        }
      },
      cleanupChats: (isForgotten) =>
        set((state) => ({
          modelByChat: Object.fromEntries(
            Object.entries(state.modelByChat).filter(
              ([chatId]) => chatId === DEFAULT_MODEL_KEY || !isForgotten(chatId),
            ),
          ),
        })),
      toggleFavoriteModel: (modelId: string) => {
        set((state) => {
          const exists = state.favoriteModelIds.includes(modelId);
          return {
            favoriteModelIds: exists
              ? state.favoriteModelIds.filter((id) => id !== modelId)
              : [...state.favoriteModelIds, modelId],
          };
        });
      },
    }),
    { name: 'model-storage' },
  ),
);
