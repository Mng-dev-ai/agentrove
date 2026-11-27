import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { chatService } from '@/services/chatService';
import { invalidateSubThreadListsContaining } from '@/hooks/queries/useChatQueries';
import {
  assignChatRecordsToMachine,
  assignChatsToMachine,
  chatMachineId,
} from '@/store/machineOrigin';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { subscribeChatEvents } from '@/hooks/chatEventSync';
import { registerActiveStreams } from '@/utils/activeStreams';
import { logger } from '@/utils/logger';
import type { ActiveStreamSnapshot } from '@/types/stream.types';

function invalidateMachineLists(queryClient: QueryClient, machineId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.machine.chats(machineId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.machine.workspaces(machineId) });
}

function getOwnedStreams(machineId: string): Promise<ActiveStreamSnapshot[]> {
  return chatService
    .getActiveStreams(machineId)
    .then((streams) => streams.filter((stream) => chatMachineId(stream.chat_id) === machineId));
}

export function useRemoteMachineSync(machineId: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    getOwnedStreams(machineId)
      .then((active) => {
        if (cancelled) return;
        registerActiveStreams(active);
      })
      .catch((error) => {
        logger.error('Machine stream restoration failed', 'useRemoteMachineSync', error);
      });

    const unsubscribe = subscribeChatEvents(queryClient, {
      machineId,
      logContext: 'useRemoteMachineSync',
      createSource: () => chatService.createChatEventsSource(machineId),
      getActiveStreams: () => getOwnedStreams(machineId),
      claim: (event) => {
        if (event.kind === 'channel_created' || event.kind === 'channel_renamed') return true;
        if (event.kind === 'chat_created') {
          assignChatRecordsToMachine(machineId, [event.chat]);
          return chatMachineId(event.chat.id) === machineId;
        }
        if (event.kind === 'stream_started') assignChatsToMachine(machineId, [event.chat_id]);
        return chatMachineId(event.chat_id) === machineId;
      },
      applyCreatedChat: (chat) => {
        queryClient.setQueryData(queryKeys.chat(chat.id), chat);
        if (chat.parent_chat_id) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.subThreads(chat.parent_chat_id),
          });
        } else {
          invalidateSubThreadListsContaining(queryClient, chat.id);
        }
        invalidateMachineLists(queryClient, machineId);
      },
      invalidateChatLists: () => invalidateMachineLists(queryClient, machineId),
      invalidateRenamedChatLists: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.machine.chats(machineId) });
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [machineId, queryClient]);
}
