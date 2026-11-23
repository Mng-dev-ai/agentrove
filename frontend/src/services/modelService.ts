import { getMachineClient } from '@/lib/api';
import { ensureResponse, withMachineAuth } from '@/services/base/BaseService';
import type { Model } from '@/types/chat.types';

async function getModels(machineId: string): Promise<Model[]> {
  return withMachineAuth(machineId, async () => {
    const response = await getMachineClient(machineId).get<Model[]>('/models/');
    return ensureResponse(response, 'Failed to fetch models');
  });
}

export const modelService = {
  getModels,
};
