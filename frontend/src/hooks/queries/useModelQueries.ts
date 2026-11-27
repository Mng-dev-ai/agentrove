import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { modelService } from '@/services/modelService';
import type { Model } from '@/types/chat.types';
import { LOCAL_MACHINE_ID, type MachineQueryOptions } from '@/types/machine.types';
import { DEFAULT_MODEL_KEY, useModelStore } from '@/store/modelStore';
import { useChatMachineId } from '@/store/machineOrigin';
import { useMachineOnline, useMachineStore, useRemoteMachineIds } from '@/store/machineStore';
import { queryKeys } from './queryKeys';
import { useChatQuery, useInfiniteMessagesQuery } from './useChatQueries';

const EMPTY_MODEL_MAP = new Map<string, Model>();

function modelsQuery(machineId: string) {
  return {
    queryKey: queryKeys.machine.models(machineId),
    queryFn: () => modelService.getModels(machineId),
  };
}

function toModelMap(models: Model[] | undefined): Map<string, Model> {
  return models ? new Map(models.map((m) => [m.model_id, m])) : EMPTY_MODEL_MAP;
}

export const useModelsQuery = (options?: MachineQueryOptions) => {
  const machineId = options?.machineId ?? LOCAL_MACHINE_ID;
  const online = useMachineOnline(machineId);
  return useQuery({
    ...modelsQuery(machineId),
    enabled: (options?.enabled ?? true) && online,
  });
};

export const useMachinesModelMaps = (enabled: boolean) => {
  const remoteIds = useRemoteMachineIds();
  const connections = useMachineStore((state) => state.connections);
  const machineIds = useMemo(() => [LOCAL_MACHINE_ID, ...remoteIds], [remoteIds]);
  const combine = useCallback(
    (results: UseQueryResult<Model[]>[]) =>
      new Map(machineIds.map((machineId, index) => [machineId, toModelMap(results[index]?.data)])),
    [machineIds],
  );
  return useQueries({
    queries: machineIds.map((machineId) => ({
      ...modelsQuery(machineId),
      enabled:
        enabled && (machineId === LOCAL_MACHINE_ID || connections[machineId]?.status === 'online'),
    })),
    combine,
  });
};

export function resolveModelId(models: Model[], modelId: string): string {
  return models.some((m) => m.model_id === modelId)
    ? modelId
    : (models.find((m) => !m.legacy)?.model_id ?? '');
}

export const useModelSelection = (options?: {
  enabled?: boolean;
  chatId?: string;
  machineId?: string;
}) => {
  const chatId = options?.chatId ?? DEFAULT_MODEL_KEY;
  const chatMachineId = useChatMachineId(options?.chatId);
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
    machineId: options?.machineId ?? chatMachineId,
  });

  const storedModelId = useModelStore((state) => state.modelByChat[chatId] ?? '');

  const storedIsValid = models.some((m) => m.model_id === storedModelId);

  const fallbackModelId =
    initialModelId === null ? '' : resolveModelId(models, initialModelId ?? '');
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
export function useModelMap(options?: MachineQueryOptions): Map<string, Model> {
  const { data: models } = useModelsQuery(options);
  return useMemo(() => toModelMap(models), [models]);
}
