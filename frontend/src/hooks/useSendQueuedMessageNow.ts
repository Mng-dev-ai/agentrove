import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMessageQueueStore } from '@/store/messageQueueStore';
import { useStreamStore } from '@/store/streamStore';
import { queryKeys } from '@/hooks/queries/queryKeys';

export function useSendQueuedMessageNow() {
  const queryClient = useQueryClient();

  return useCallback(
    async (chatId: string, messageId: string) => {
      const success = await useMessageQueueStore.getState().sendNow(chatId, messageId);
      if (success && !useStreamStore.getState().getStreamByChat(chatId)) {
        useMessageQueueStore.getState().removeLocalOnly(chatId, messageId);
        await queryClient.invalidateQueries({ queryKey: queryKeys.messages(chatId) });
      }
    },
    [queryClient],
  );
}
