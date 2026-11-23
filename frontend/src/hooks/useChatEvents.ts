import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { chatService } from '@/services/chatService';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { applyCreatedChat } from '@/hooks/queries/useChatQueries';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { subscribeChatEvents } from '@/hooks/chatEventSync';
import { logger } from '@/utils/logger';

export function useChatEvents(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    return subscribeChatEvents(queryClient, {
      logContext: 'useChatEvents',
      createSource: () => chatService.createChatEventsSource(LOCAL_MACHINE_ID),
      getActiveStreams: () => chatService.getActiveStreams(LOCAL_MACHINE_ID),
      claim: () => true,
      applyCreatedChat: (chat) => {
        void applyCreatedChat(queryClient, chat).catch((error) =>
          logger.error('Chat cache update failed', 'useChatEvents', error),
        );
      },
      invalidateChatLists: () => {
        void queryClient.invalidateQueries({ queryKey: [queryKeys.chats, 'infinite'] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      },
      // patchChatInCache already renamed every local list.
      invalidateRenamedChatLists: () => {},
    });
  }, [enabled, queryClient]);
}
