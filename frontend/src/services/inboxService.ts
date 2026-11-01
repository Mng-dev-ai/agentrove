import { apiClient } from '@/lib/api';
import { buildQueryString, ensureResponse, serviceCall } from '@/services/base/BaseService';
import type { InboxItem, InboxList } from '@/types/inbox.types';

async function listInbox(cursor?: string): Promise<InboxList> {
  return serviceCall(async () => {
    const response = await apiClient.get<InboxList>(
      `/inbox${buildQueryString(cursor ? { cursor } : {})}`,
    );
    return ensureResponse(response, 'Failed to load inbox');
  });
}

async function markRead(itemId: string): Promise<InboxItem> {
  return serviceCall(async () => {
    const response = await apiClient.post<InboxItem>(`/inbox/${itemId}/read`);
    return ensureResponse(response, 'Failed to mark message as read');
  });
}

async function markAllRead(): Promise<void> {
  await serviceCall(async () => {
    await apiClient.post('/inbox/read-all');
  });
}

async function clearRead(): Promise<void> {
  await serviceCall(async () => {
    await apiClient.delete('/inbox/read');
  });
}

export const inboxService = {
  listInbox,
  markRead,
  markAllRead,
  clearRead,
};
