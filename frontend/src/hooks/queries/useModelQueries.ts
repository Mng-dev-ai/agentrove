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
  const { data: models = [] } = useModelsQuery({
    enabled: options?.enabled,
  });

  const storedModelId = useModelStore((state) => state.modelByChat[chatId] ?? '');

  const storedIsValid = models.some((m) => m.model_id === storedModelId);

  // Empty while invalid so a stale id can't be submitted mid-resolve.
  const selectedModelId = models.length === 0 || storedIsValid ? storedModelId : '';

  useEffect(() => {
    if (models.length === 0 || storedIsValid) return;

    // null = still loading history; don't default yet.
    if (initialModelId === null) return;

    const fallback =
      initialModelId && models.some((m) => m.model_id === initialModelId)
        ? initialModelId
        : models.find((m) => !m.legacy)?.model_id;
    if (fallback) useModelStore.getState().selectModel(chatId, fallback);
  }, [models, storedIsValid, chatId, initialModelId]);

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
