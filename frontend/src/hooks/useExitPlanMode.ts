import { useState, useCallback } from 'react';
import { permissionService } from '@/services/permissionService';
import { usePermissionStore } from '@/store/permissionStore';
import { useChatSettingsStore } from '@/store/chatSettingsStore';
import { executePermissionResponse, clearPermissionRequest } from '@/utils/permissionResponse';

export function useExitPlanMode(chatId: string | undefined) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The ExitPlanMode request renders in its own tool card, independent of the
  // inline permission prompt, so pick it out of the queue wherever it sits
  // rather than only checking the head.
  const pendingRequest = usePermissionStore((state) => {
    if (!chatId) return null;
    const queue = state.pendingRequests.get(chatId);
    return queue?.find((r) => r.tool_name === 'ExitPlanMode') ?? null;
  });

  const handleApprove = useCallback(
    async (optionId: string) => {
      if (!chatId || !pendingRequest) return;

      const result = await executePermissionResponse(
        () => permissionService.respondToPermission(chatId, pendingRequest.request_id, optionId),
        {
          setIsLoading,
          setError,
          errorMessage: 'Failed to approve plan',
          clearRequest: () =>
            clearPermissionRequest(chatId, pendingRequest.request_id, pendingRequest.seq),
        },
      );
      if (result === 'success' || result === 'expired') {
        const nextPermissionMode =
          pendingRequest.options.find((option) => option.option_id === optionId)?.permission_mode ??
          null;
        if (result === 'success' && nextPermissionMode) {
          useChatSettingsStore.getState().setPermissionMode(chatId, nextPermissionMode);
        }
      }
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
          errorMessage: 'Failed to reject plan',
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
    handleApprove,
    handleReject,
  };
}
