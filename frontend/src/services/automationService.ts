import { getMachineClient } from '@/lib/api';
import { ensureResponse, serviceCall } from '@/services/base/BaseService';
import { assignChatsToMachine } from '@/store/machineOrigin';
import type {
  Automation,
  AutomationCreateRequest,
  AutomationRunResponse,
  AutomationUpdateRequest,
} from '@/types/automation.types';

async function listAutomations(machineId: string): Promise<Automation[]> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).get<Automation[]>('/automations');
    return ensureResponse(response, 'Failed to load automations');
  });
}

async function createAutomation(
  data: AutomationCreateRequest,
  machineId: string,
): Promise<Automation> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).post<Automation>('/automations', data);
    return ensureResponse(response, 'Failed to create automation');
  });
}

async function updateAutomation(
  automationId: string,
  data: AutomationUpdateRequest,
  machineId: string,
): Promise<Automation> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).patch<Automation>(
      `/automations/${automationId}`,
      data,
    );
    return ensureResponse(response, 'Failed to update automation');
  });
}

async function deleteAutomation(automationId: string, machineId: string): Promise<void> {
  await serviceCall(async () => {
    await getMachineClient(machineId).delete(`/automations/${automationId}`);
  });
}

async function runAutomation(
  automationId: string,
  machineId: string,
): Promise<AutomationRunResponse> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).post<AutomationRunResponse>(
      `/automations/${automationId}/run`,
    );
    const payload = ensureResponse(response, 'Failed to run automation');
    if (payload.chat_id) assignChatsToMachine(machineId, [payload.chat_id]);
    return payload;
  });
}

export const automationService = {
  listAutomations,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  runAutomation,
};
