import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { machineChatService } from '@/services/machineChatService';
import { patchChatInCache } from '@/hooks/queries/useChatQueries';
import {
  assignChatRecordsToMachine,
  assignChatsToMachine,
  chatMachineId,
} from '@/store/machineOrigin';
import { useUIStore } from '@/store/uiStore';
import { useStreamStore } from '@/store/streamStore';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { subscribeChatEventsFeed } from '@/utils/chatEventsFeed';
import { registerActiveStreams, resyncActiveStreams } from '@/utils/activeStreams';
import { logger } from '@/utils/logger';
import { insertStartedTurnInCache } from '@/hooks/stream/cachePatch';
import type { ChatEvent } from '@/types/chat.types';
import type { ActiveStreamSnapshot } from '@/types/stream.types';

function invalidateMachineLists(queryClient: QueryClient, machineId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.machine.chats(machineId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.machine.workspaces(machineId) });
}

function ownedStreams(machineId: string, streams: ActiveStreamSnapshot[]): ActiveStreamSnapshot[] {
  return streams.filter((stream) => chatMachineId(stream.chat_id) === machineId);
}

export function useRemoteMachineSync(machineId: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    machineChatService
      .getActiveStreams(machineId)
      .then((active) => {
        if (cancelled) return;
        registerActiveStreams(ownedStreams(machineId, active));
      })
      .catch((error) => {
        logger.error('Machine stream restoration failed', 'useRemoteMachineSync', error);
      });

    const onChatEvent = (event: MessageEvent) => {
      if (!event.data) return;
      let parsed: ChatEvent;
      try {
        parsed = JSON.parse(event.data) as ChatEvent;
      } catch (error) {
        logger.error('Malformed machine chat event', 'useRemoteMachineSync', error);
        return;
      }

      if (parsed.kind === 'chat_created') {
        const chat = parsed.chat;
        assignChatRecordsToMachine(machineId, [chat]);
        if (chatMachineId(chat.id) !== machineId) return;
        queryClient.setQueryData(queryKeys.chat(chat.id), chat);
        if (chat.parent_chat_id) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.subThreads(chat.parent_chat_id),
          });
        }
        invalidateMachineLists(queryClient, machineId);
        useUIStore.getState().openChatTab(chat.id);
        return;
      }

      if (parsed.kind === 'title_updated') {
        if (chatMachineId(parsed.chat_id) !== machineId) return;
        patchChatInCache(queryClient, parsed.chat_id, (chat) => ({
          ...chat,
          title: parsed.title,
        }));
        void queryClient.invalidateQueries({ queryKey: queryKeys.machine.chats(machineId) });
        return;
      }

      if (parsed.kind === 'stream_started') {
        assignChatsToMachine(machineId, [parsed.chat_id]);
        if (chatMachineId(parsed.chat_id) !== machineId) return;
        useUIStore.getState().openChatTab(parsed.chat_id);
        invalidateMachineLists(queryClient, machineId);
        void queryClient.invalidateQueries({ queryKey: queryKeys.chat(parsed.chat_id) });
        insertStartedTurnInCache(queryClient, parsed);
        useStreamStore.getState().addStreamMetadataIfAbsent({
          chatId: parsed.chat_id,
          messageId: parsed.message_id,
          startTime: Date.now(),
        });
      }
    };

    const unsubscribe = subscribeChatEventsFeed({
      createSource: () => machineChatService.createChatEventsSource(machineId),
      onChatEvent,
      onResync: () => {
        invalidateMachineLists(queryClient, machineId);
        void queryClient.invalidateQueries({ queryKey: ['chat'] });
        resyncActiveStreams(
          () =>
            machineChatService
              .getActiveStreams(machineId)
              .then((streams) => ownedStreams(machineId, streams)),
          () => cancelled,
          'useRemoteMachineSync',
        );
      },
      logContext: 'useRemoteMachineSync',
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [machineId, queryClient]);
}
