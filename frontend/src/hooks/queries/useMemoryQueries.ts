import { useCallback, useMemo } from 'react';
import { useQueries, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useOnlineRemoteMachineIds } from '@/store/machineStore';
import { memoryService } from '@/services/memoryService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { Memory, MemoryCreateRequest, MemoryUpdateRequest } from '@/types/memory.types';

const memoriesKey = (machineId: string, workspaceId: string | null) =>
  machineId === LOCAL_MACHINE_ID
    ? queryKeys.memories(workspaceId)
    : queryKeys.machine.memories(machineId, workspaceId);

function invalidateMemories(queryClient: QueryClient, machineId: string) {
  void queryClient.invalidateQueries({
    queryKey:
      machineId === LOCAL_MACHINE_ID
        ? queryKeys.memoriesAll
        : queryKeys.machine.memoriesAll(machineId),
  });
}

export interface MachineMemory {
  memory: Memory;
  machineId: string;
}

export interface MemoryWorkspaceFilter {
  machineId: string;
  workspaceId: string;
}

export const useMemoriesAcrossMachines = (
  filter: MemoryWorkspaceFilter | null,
): MachineMemory[] | null => {
  const remoteIds = useOnlineRemoteMachineIds();
  const filterMachineId = filter?.machineId;
  const workspaceId = filter?.workspaceId ?? null;
  const machineIds = useMemo(
    () =>
      [LOCAL_MACHINE_ID, ...remoteIds].filter(
        (machineId) => !filterMachineId || machineId === filterMachineId,
      ),
    [remoteIds, filterMachineId],
  );
  const combine = useCallback(
    (results: UseQueryResult<Memory[]>[]) => {
      if (results.some((result) => result.isLoading)) return null;
      return machineIds.flatMap((machineId, index) =>
        (results[index]?.data ?? []).map((memory) => ({ memory, machineId })),
      );
    },
    [machineIds],
  );
  return useQueries({
    queries: machineIds.map((machineId) => ({
      queryKey: memoriesKey(machineId, workspaceId),
      queryFn: () => memoryService.listMemories(workspaceId, machineId),
      staleTime: 30_000,
    })),
    combine,
  });
};

export const useCreateMemoryMutation = createMutation<
  Memory,
  Error,
  { data: MemoryCreateRequest; machineId: string }
>(
  ({ data, machineId }) => memoryService.createMemory(data, machineId),
  (queryClient, _data, variables) => invalidateMemories(queryClient, variables.machineId),
);

export const useUpdateMemoryMutation = createMutation<
  Memory,
  Error,
  { memoryId: string; data: MemoryUpdateRequest; machineId: string }
>(
  ({ memoryId, data, machineId }) => memoryService.updateMemory(memoryId, data, machineId),
  (queryClient, _data, variables) => invalidateMemories(queryClient, variables.machineId),
);

export const useDeleteMemoryMutation = createMutation<
  void,
  Error,
  { memoryId: string; machineId: string }
>(
  ({ memoryId, machineId }) => memoryService.deleteMemory(memoryId, machineId),
  (queryClient, _data, variables) => invalidateMemories(queryClient, variables.machineId),
);
