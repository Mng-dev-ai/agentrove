import { getMachineClient } from '@/lib/api';
import { buildQueryString, ensureResponse, serviceCall } from '@/services/base/BaseService';
import { assignChatsToMachine } from '@/store/machineOrigin';
import type { InboxItem, InboxList } from '@/types/inbox.types';

async function listInbox(cursor: string | undefined, machineId: string): Promise<InboxList> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).get<InboxList>(
      `/inbox${buildQueryString(cursor ? { cursor } : {})}`,
    );
    const inbox = ensureResponse(response, 'Failed to load inbox');
    assignChatsToMachine(
      machineId,
      inbox.items.map((item) => item.chat_id),
    );
    return inbox;
  });
}

async function markRead(itemId: string, machineId: string): Promise<InboxItem> {
  return serviceCall(async () => {
    const response = await getMachineClient(machineId).post<InboxItem>(`/inbox/${itemId}/read`);
    return ensureResponse(response, 'Failed to mark message as read');
  });
}

async function markAllRead(machineId: string): Promise<void> {
  await serviceCall(async () => {
    await getMachineClient(machineId).post('/inbox/read-all');
  });
}

async function clearRead(machineId: string): Promise<void> {
  await serviceCall(async () => {
    await getMachineClient(machineId).delete('/inbox/read');
  });
}

export const inboxService = {
  listInbox,
  markRead,
  markAllRead,
  clearRead,
};
