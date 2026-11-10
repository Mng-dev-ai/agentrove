import { getMachineClient } from '@/lib/api';
import { buildQueryString, ensureResponse, serviceCall } from '@/services/base/BaseService';
import type { Memory, MemoryCreateRequest, MemoryUpdateRequest } from '@/types/memory.types';

async function listMemories(workspaceId: string | null, machineId: string): Promise<Memory[]> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).get<Memory[]>(
      `/memories${buildQueryString({ workspace_id: workspaceId })}`,
    );
    return ensureResponse(response, 'Failed to load memories');
  });
}

async function createMemory(data: MemoryCreateRequest, machineId: string): Promise<Memory> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).post<Memory>('/memories', data);
    return ensureResponse(response, 'Failed to create memory');
  });
}

async function updateMemory(
  memoryId: string,
  data: MemoryUpdateRequest,
  machineId: string,
): Promise<Memory> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).patch<Memory>(`/memories/${memoryId}`, data);
    return ensureResponse(response, 'Failed to update memory');
  });
}

async function deleteMemory(memoryId: string, machineId: string): Promise<void> {
  await serviceCall(async () => {
    await getMachineClient(machineId).delete(`/memories/${memoryId}`);
  });
}

export const memoryService = {
  listMemories,
  createMemory,
  updateMemory,
  deleteMemory,
};
