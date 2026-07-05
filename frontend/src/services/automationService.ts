import { apiClient, remoteApiClient } from '@/lib/api';
import { ensureResponse, serviceCall } from '@/services/base/BaseService';
import { markCloudChats } from '@/utils/chatOrigin';
import type {
  Automation,
  AutomationCreateRequest,
  AutomationUpdateRequest,
} from '@/types/automation.types';

// Automations live on whichever backend runs them — the local instance or the
// connected cloud VPS (same API shape) — so every call routes by onCloud.
function clientFor(onCloud: boolean) {
  return onCloud ? remoteApiClient : apiClient;
}

async function listAutomations(onCloud: boolean): Promise<Automation[]> {
  return serviceCall(async () => {
    const response = await clientFor(onCloud).get<Automation[]>('/automations');
    return ensureResponse(response, 'Failed to load automations');
  });
}

async function createAutomation(
  data: AutomationCreateRequest,
  onCloud: boolean,
): Promise<Automation> {
  return serviceCall(async () => {
    const response = await clientFor(onCloud).post<Automation>('/automations', data);
    return ensureResponse(response, 'Failed to create automation');
  });
}

async function updateAutomation(
  automationId: string,
  data: AutomationUpdateRequest,
  onCloud: boolean,
): Promise<Automation> {
  return serviceCall(async () => {
    const response = await clientFor(onCloud).patch<Automation>(
      `/automations/${automationId}`,
      data,
    );
    return ensureResponse(response, 'Failed to update automation');
  });
}

async function deleteAutomation(automationId: string, onCloud: boolean): Promise<void> {
  await serviceCall(async () => {
    await clientFor(onCloud).delete(`/automations/${automationId}`);
  });
}

async function runAutomation(automationId: string, onCloud: boolean): Promise<{ chat_id: string }> {
  return serviceCall(async () => {
    const response = await clientFor(onCloud).post<{ chat_id: string }>(
      `/automations/${automationId}/run`,
    );
    const payload = ensureResponse(response, 'Failed to run automation');
    // A cloud run's chat lives on the VPS — register it so opening it routes there.
    if (onCloud) {
      markCloudChats([payload.chat_id]);
    }
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
