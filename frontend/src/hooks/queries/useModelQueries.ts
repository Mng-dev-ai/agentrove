import { useQuery } from '@tanstack/react-query';
import type { UseQueryOptions } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { modelService } from '@/services/modelService';
import type { Model } from '@/types/chat.types';
import { useModelStore } from '@/store/modelStore';
import { queryKeys } from './queryKeys';

const EMPTY_MODEL_MAP = new Map<string, Model>();
const DEFAULT_MODEL_KEY = '__default__';

export const useModelsQuery = (options?: Partial<UseQueryOptions<Model[]>>) => {
  return useQuery({
    queryKey: [queryKeys.models],
    queryFn: () => modelService.getModels(),
    ...options,
  });
};

export const useModelSelection = (options?: {
  enabled?: boolean;
  chatId?: string;
  // null = still loading (defer default), undefined = no initial model (use models[0])
  initialModelId?: string | null;
}) => {
  const chatId = options?.chatId ?? DEFAULT_MODEL_KEY;
  const initialModelId = options?.initialModelId;
  const { data: models = [], isLoading } = useModelsQuery({
    enabled: options?.enabled,
  });

  const selectedModelId = useModelStore((state) => state.modelByChat[chatId] ?? '');

  useEffect(() => {
    if (models.length === 0) return;
    const selectedExists = models.some((m) => m.model_id === selectedModelId);
    if (selectedExists) return;

    // Still loading initial model from message history — wait before defaulting
    if (initialModelId === null) return;

    const fallback =
      initialModelId && models.some((m) => m.model_id === initialModelId)
        ? initialModelId
        : models[0].model_id;
    useModelStore.getState().selectModel(chatId, fallback);
  }, [models, selectedModelId, chatId, initialModelId]);

  const selectedModel = useMemo(
    () => models.find((m) => m.model_id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  const selectModel = useCallback(
    (modelId: string) => useModelStore.getState().selectModel(chatId, modelId),
    [chatId],
  );

  return { models, selectedModelId, selectedModel, selectModel, isLoading };
};

// `/models/` is auth-protected — public-route callers must gate; default-on
// keeps authenticated callers unchanged.
export function useModelMap(enabled: boolean = true): Map<string, Model> {
  const { data: models } = useModelsQuery({ enabled });
  return useMemo(
    () => (models ? new Map(models.map((m) => [m.model_id, m])) : EMPTY_MODEL_MAP),
    [models],
  );
}
