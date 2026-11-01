import { apiClient } from '@/lib/api';
import { buildQueryString, ensureResponse, serviceCall } from '@/services/base/BaseService';
import type { Memory, MemoryCreateRequest, MemoryUpdateRequest } from '@/types/memory.types';

async function listMemories(workspaceId: string | null): Promise<Memory[]> {
  return serviceCall(async () => {
    const response = await apiClient.get<Memory[]>(
      `/memories${buildQueryString({ workspace_id: workspaceId })}`,
    );
    return ensureResponse(response, 'Failed to load memories');
  });
}

async function createMemory(data: MemoryCreateRequest): Promise<Memory> {
  return serviceCall(async () => {
    const response = await apiClient.post<Memory>('/memories', data);
    return ensureResponse(response, 'Failed to create memory');
  });
}

async function updateMemory(memoryId: string, data: MemoryUpdateRequest): Promise<Memory> {
  return serviceCall(async () => {
    const response = await apiClient.patch<Memory>(`/memories/${memoryId}`, data);
    return ensureResponse(response, 'Failed to update memory');
  });
}

async function deleteMemory(memoryId: string): Promise<void> {
  await serviceCall(async () => {
    await apiClient.delete(`/memories/${memoryId}`);
  });
}

export const memoryService = {
  listMemories,
  createMemory,
  updateMemory,
  deleteMemory,
};
