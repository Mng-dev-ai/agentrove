import { useQuery } from '@tanstack/react-query';
import { memoryService } from '@/services/memoryService';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { createMutation } from '@/hooks/queries/createMutation';
import type { Memory, MemoryCreateRequest, MemoryUpdateRequest } from '@/types/memory.types';

export const useMemoriesQuery = (workspaceId: string | null) =>
  useQuery<Memory[]>({
    queryKey: queryKeys.memories(workspaceId),
    queryFn: () => memoryService.listMemories(workspaceId),
    staleTime: 30_000,
  });

export const useCreateMemoryMutation = createMutation<Memory, Error, MemoryCreateRequest>(
  (data) => memoryService.createMemory(data),
  (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.memoriesAll }),
);

export const useUpdateMemoryMutation = createMutation<
  Memory,
  Error,
  { memoryId: string; data: MemoryUpdateRequest }
>(
  ({ memoryId, data }) => memoryService.updateMemory(memoryId, data),
  (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.memoriesAll }),
);

export const useDeleteMemoryMutation = createMutation<void, Error, string>(
  (memoryId) => memoryService.deleteMemory(memoryId),
  (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.memoriesAll }),
);
