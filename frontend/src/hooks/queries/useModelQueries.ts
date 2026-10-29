import { useQuery } from '@tanstack/react-query';
import type { UseQueryOptions } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { modelService } from '@/services/modelService';
import type { Model } from '@/types/chat.types';
import { useModelStore } from '@/store/modelStore';
import { queryKeys } from './queryKeys';
import { useChatQuery, useInfiniteMessagesQuery } from './useChatQueries';

const EMPTY_MODEL_MAP = new Map<string, Model>();
const DEFAULT_MODEL_KEY = '__default__';

export const useModelsQuery = (options?: Partial<UseQueryOptions<Model[]>>) => {
  return useQuery({
    queryKey: [queryKeys.models],
    queryFn: () => modelService.getModels(),
    ...options,
  });
};

export const useModelSelection = (options?: { enabled?: boolean; chatId?: string }) => {
  const chatId = options?.chatId ?? DEFAULT_MODEL_KEY;
  const { data: chat } = useChatQuery(options?.chatId);
  const messagesQuery = useInfiniteMessagesQuery(chat?.last_model_id ? undefined : options?.chatId);
  const initialModelId =
    chat?.last_model_id ??
    messagesQuery.data?.pages
      .flatMap((page) => page.items)
      .find((message) => message.role === 'assistant' && message.model_id)?.model_id ??
    (messagesQuery.isLoading ? null : undefined);
  const { data: models = [] } = useModelsQuery({
    enabled: options?.enabled,
  });

  const storedModelId = useModelStore((state) => state.modelByChat[chatId] ?? '');

  const storedIsValid = models.some((m) => m.model_id === storedModelId);

  const fallbackModelId =
    initialModelId && models.some((m) => m.model_id === initialModelId)
      ? initialModelId
      : initialModelId === null
        ? ''
        : (models.find((m) => !m.legacy)?.model_id ?? '');
  const selectedModelId = storedIsValid ? storedModelId : fallbackModelId;

  const selectedModel = useMemo(
    () => models.find((m) => m.model_id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  const selectModel = useCallback(
    (modelId: string) => useModelStore.getState().selectModel(chatId, modelId),
    [chatId],
  );

  return { selectedModelId, selectedModel, selectModel };
};

// `/models/` is auth-protected — public callers must pass enabled=false.
export function useModelMap(enabled: boolean = true): Map<string, Model> {
  const { data: models } = useModelsQuery({ enabled });
  return useMemo(
    () => (models ? new Map(models.map((m) => [m.model_id, m])) : EMPTY_MODEL_MAP),
    [models],
  );
}
