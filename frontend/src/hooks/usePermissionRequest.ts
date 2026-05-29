import { useState, useCallback, useRef } from 'react';
import { permissionService } from '@/services/permissionService';
import { usePermissionStore } from '@/store/permissionStore';
import { isPermissionResolved } from '@/utils/permissionStorage';
import { notifyPermissionRequest } from '@/utils/notifications';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import { executePermissionResponse, clearPermissionRequest } from '@/utils/permissionResponse';
import type { PermissionRequest } from '@/types/chat.types';

interface UsePermissionRequestReturn {
  pendingRequest: PermissionRequest | null;
  isLoading: boolean;
  error: string | null;
  handlePermissionRequest: (request: PermissionRequest) => void;
  handleApprove: (optionId: string) => Promise<void>;
  handleReject: (optionId: string) => Promise<void>;
}

// Manages the tool-permission approval flow for a single chat. Reads the
// pending request from the global permission store, sends approve/reject
// responses to the backend, and auto-dismisses 404s (expired requests where
// the backend already timed out or the stream moved on).
export function usePermissionRequest(chatId: string | undefined): UsePermissionRequestReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: settings } = useSettingsQuery();

  // Surface the head of this chat's permission queue. Selecting only this
  // chat's queue avoids re-renders from other chats' permission changes; we
  // process requests one at a time in FIFO order.
  const pendingRequest = usePermissionStore((state) => {
    if (!chatId) return null;
    const queue = state.pendingRequests.get(chatId);
    return queue && queue.length > 0 ? queue[0] : null;
  });
  const prevRequestIdRef = useRef(pendingRequest?.request_id);

  // Clear stale error when a new permission request arrives, so errors from
  // a previous request don't bleed into the new approval dialog.
  if (prevRequestIdRef.current !== pendingRequest?.request_id) {
    prevRequestIdRef.current = pendingRequest?.request_id;
    if (error !== null) setError(null);
  }

  const handlePermissionRequest = useCallback(
    (request: PermissionRequest) => {
      if (!chatId) return;
      // Drop permission events the user already answered — the backend persists
      // and replays them after `after_seq` on refresh/reconnect.
      if (isPermissionResolved(chatId, request.seq)) return;

      // The store dedupes against requests already pending in this chat's
      // queue; only notify when it was a genuinely new request, not a
      // duplicate envelope for one still awaiting a response.
      const added = usePermissionStore.getState().enqueuePermissionRequest(chatId, request);
      if (added && (settings?.notifications_enabled ?? true)) {
        void notifyPermissionRequest(request);
      }
    },
    [chatId, settings?.notifications_enabled],
  );

  const handleApprove = useCallback(
    async (optionId: string) => {
      if (!chatId || !pendingRequest) return;

      await executePermissionResponse(
        () => permissionService.respondToPermission(chatId, pendingRequest.request_id, optionId),
        {
          setIsLoading,
          setError,
          errorMessage: 'Failed to approve permission',
          clearRequest: () =>
            clearPermissionRequest(chatId, pendingRequest.request_id, pendingRequest.seq),
        },
      );
    },
    [chatId, pendingRequest],
  );

  const handleReject = useCallback(
    async (optionId: string) => {
      if (!chatId || !pendingRequest) return;

      await executePermissionResponse(
        () => permissionService.respondToPermission(chatId, pendingRequest.request_id, optionId),
        {
          setIsLoading,
          setError,
          errorMessage: 'Failed to reject permission',
          clearRequest: () =>
            clearPermissionRequest(chatId, pendingRequest.request_id, pendingRequest.seq),
        },
      );
    },
    [chatId, pendingRequest],
  );

  return {
    pendingRequest,
    isLoading,
    error,
    handlePermissionRequest,
    handleApprove,
    handleReject,
  };
}
