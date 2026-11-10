import { chatService } from '@/services/chatService';
import { useElicitationStore } from '@/store/elicitationStore';
import { usePermissionStore } from '@/store/permissionStore';
import type { ChatStatusResponse } from '@/types/chat.types';

export async function syncChatStatus(
  chatId: string,
  isCurrent: () => boolean,
): Promise<ChatStatusResponse | null> {
  const knownElicitationIds = new Set(
    useElicitationStore
      .getState()
      .pendingRequests.get(chatId)
      ?.map((r) => r.request_id),
  );
  const knownPermissionIds = new Set(
    usePermissionStore
      .getState()
      .pendingRequests.get(chatId)
      ?.map((r) => r.request_id),
  );
  const status = await chatService.checkChatStatus(chatId);
  if (!isCurrent() || !status) return null;

  if (status.pending_elicitations) {
    useElicitationStore
      .getState()
      .reconcileElicitationRequests(chatId, status.pending_elicitations, knownElicitationIds);
  }
  if (status.pending_permissions) {
    usePermissionStore
      .getState()
      .reconcilePermissionRequests(chatId, status.pending_permissions, knownPermissionIds);
  } else if (status.pending_permission_ids) {
    // Older paired-machine backends send ids only: keep the queued prompts they still list.
    const serverIds = new Set(status.pending_permission_ids);
    const listed = (usePermissionStore.getState().pendingRequests.get(chatId) ?? []).filter((r) =>
      serverIds.has(r.request_id),
    );
    usePermissionStore.getState().reconcilePermissionRequests(chatId, listed, knownPermissionIds);
  }
  return status;
}
