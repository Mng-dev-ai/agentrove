import { useState, useCallback, useRef } from 'react';
import { elicitationService } from '@/services/elicitationService';
import { useElicitationStore } from '@/store/elicitationStore';
import { executePermissionResponse } from '@/utils/permissionResponse';
import type { ElicitationAction, ElicitationContent, ElicitationRequest } from '@/types/chat.types';

interface UseElicitationRequestReturn {
  pendingRequest: ElicitationRequest | null;
  isLoading: boolean;
  error: string | null;
  handleElicitationRequest: (request: ElicitationRequest) => void;
  handleElicitationDismissed: (requestId: string) => void;
  handleSubmit: (content: ElicitationContent) => Promise<void>;
  handleSkip: () => Promise<void>;
  handleCancel: () => Promise<void>;
}

// Agent-asked form for one chat; 404s (expired/withdrawn requests) auto-dismiss.
export function useElicitationRequest(chatId: string | undefined): UseElicitationRequestReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Select only this chat's queue so other chats' forms don't re-render us.
  const pendingRequest = useElicitationStore((state) => {
    if (!chatId) return null;
    const queue = state.pendingRequests.get(chatId);
    return queue && queue.length > 0 ? queue[0] : null;
  });
  const prevRequestIdRef = useRef(pendingRequest?.request_id);

  // Don't bleed a previous form's error into the next one.
  if (prevRequestIdRef.current !== pendingRequest?.request_id) {
    prevRequestIdRef.current = pendingRequest?.request_id;
    if (error !== null) setError(null);
  }

  const handleElicitationRequest = useCallback(
    (request: ElicitationRequest) => {
      if (!chatId) return;
      useElicitationStore.getState().enqueueElicitationRequest(chatId, request);
    },
    [chatId],
  );

  const handleElicitationDismissed = useCallback(
    (requestId: string) => {
      if (!chatId) return;
      useElicitationStore.getState().resolveElicitationRequest(chatId, requestId);
    },
    [chatId],
  );

  const respond = useCallback(
    async (action: ElicitationAction, content: ElicitationContent | null) => {
      if (!chatId || !pendingRequest) return;

      await executePermissionResponse(
        () =>
          elicitationService.respondToElicitation(
            chatId,
            pendingRequest.request_id,
            action,
            content,
          ),
        {
          setIsLoading,
          setError,
          errorMessage: 'Failed to send your answer',
          clearRequest: () =>
            useElicitationStore
              .getState()
              .resolveElicitationRequest(chatId, pendingRequest.request_id),
        },
      );
    },
    [chatId, pendingRequest],
  );

  const handleSubmit = useCallback(
    (content: ElicitationContent) => respond('accept', content),
    [respond],
  );
  const handleSkip = useCallback(() => respond('decline', null), [respond]);
  const handleCancel = useCallback(() => respond('cancel', null), [respond]);

  return {
    pendingRequest,
    isLoading,
    error,
    handleElicitationRequest,
    handleElicitationDismissed,
    handleSubmit,
    handleSkip,
    handleCancel,
  };
}
