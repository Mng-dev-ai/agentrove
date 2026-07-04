import { useQuery } from '@tanstack/react-query';
import type { UseQueryOptions } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { modelService } from '@/services/modelService';
import type { AgentKind, Model } from '@/types/chat.types';
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
  // Restricts valid selections to one provider (chats with an established session)
  lockedAgentKind?: AgentKind | null;
}) => {
  const chatId = options?.chatId ?? DEFAULT_MODEL_KEY;
  const initialModelId = options?.initialModelId;
  const lockedAgentKind = options?.lockedAgentKind;
  const { data: models = [] } = useModelsQuery({
    enabled: options?.enabled,
  });

  const storedModelId = useModelStore((state) => state.modelByChat[chatId] ?? '');

  // Models valid for this chat — restricted to the locked provider once the
  // session kind is known; stale entries (retired ids, wrong-kind values
  // persisted by old versions) count as invalid.
  const candidates = useMemo(
    () => (lockedAgentKind ? models.filter((m) => m.agent_kind === lockedAgentKind) : models),
    [models, lockedAgentKind],
  );

  const storedIsValid = candidates.some((m) => m.model_id === storedModelId);

  // Expose invalid stored values as empty so a stale cross-provider selection
  // can't be submitted while the real model is still resolving from history;
  // pass stored through until the registry loads (nothing to validate yet).
  const selectedModelId = models.length === 0 || storedIsValid ? storedModelId : '';

  useEffect(() => {
    if (candidates.length === 0 || storedIsValid) return;

    // Still loading initial model from message history — wait before defaulting
    if (initialModelId === null) return;

    const fallback =
      initialModelId && candidates.some((m) => m.model_id === initialModelId)
        ? initialModelId
        : candidates[0].model_id;
    useModelStore.getState().selectModel(chatId, fallback);
  }, [candidates, storedIsValid, chatId, initialModelId]);

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

// `/models/` is auth-protected — public-route callers must gate; default-on
// keeps authenticated callers unchanged.
export function useModelMap(enabled: boolean = true): Map<string, Model> {
  const { data: models } = useModelsQuery({ enabled });
  return useMemo(
    () => (models ? new Map(models.map((m) => [m.model_id, m])) : EMPTY_MODEL_MAP),
    [models],
  );
}
