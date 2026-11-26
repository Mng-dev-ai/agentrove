import { getMachineClient } from '@/lib/api';
import { ensureResponse, serviceCall } from '@/services/base/BaseService';
import type { InstanceInfo } from '@/types/machine.types';

async function getInstance(machineId: string): Promise<InstanceInfo> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).get<InstanceInfo>('/instance');
    return ensureResponse(response, 'Failed to fetch instance info');
  });
}

export const instanceService = { getInstance };
