import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { chatService } from '@/services/chatService';
import { applyCreatedChat, patchChatInCache } from '@/hooks/queries/useChatQueries';
import { useUIStore } from '@/store/uiStore';
import { useStreamStore } from '@/store/streamStore';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { subscribeChatEventsFeed } from '@/utils/chatEventsFeed';
import { resyncActiveStreams } from '@/utils/activeStreams';
import { logger } from '@/utils/logger';
import type { ChatEvent } from '@/types/chat.types';

// Per-user chat lifecycle SSE: out-of-band creates/turns (MCP, agents) surface live.
export function useChatEvents(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    // Guards in-flight resync snapshots across teardown (logout flips enabled) —
    // a late response must not register ghost stream indicators.
    let cancelled = false;

    const onChatEvent = (event: MessageEvent) => {
      if (!event.data) return;
      let parsed: ChatEvent;
      try {
        parsed = JSON.parse(event.data) as ChatEvent;
      } catch (error) {
        logger.error('Malformed chat event', 'useChatEvents', error);
        return;
      }

      if (parsed.kind === 'chat_created') {
        void applyCreatedChat(queryClient, parsed.chat).catch((error) =>
          logger.error('Chat cache update failed', 'useChatEvents', error),
        );
        useUIStore.getState().openChatTab(parsed.chat.id);
        return;
      }

      if (parsed.kind === 'title_updated') {
        // Mid-stream title backfill — patch caches so sidebar/tab rename without refetch.
        patchChatInCache(queryClient, parsed.chat_id, (chat) => ({
          ...chat,
          title: parsed.title,
        }));
        return;
      }

      if (parsed.kind === 'stream_started') {
        // Out-of-band turns on existing chats skip chat_created — open the tab here.
        useUIStore.getState().openChatTab(parsed.chat_id);
        // Server bumps updated_at — refetch so chats outside loaded pages surface.
        queryClient.invalidateQueries({ queryKey: [queryKeys.chats, 'infinite'] });
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
        // Drop cached detail so toolbar seeds model/thinking/persona from this turn.
        queryClient.invalidateQueries({ queryKey: queryKeys.chat(parsed.chat_id) });
        // Self-starts already have addStream; settled orphans pruned by useGlobalStream.
        useStreamStore.getState().addStreamMetadataIfAbsent({
          chatId: parsed.chat_id,
          messageId: parsed.message_id,
          startTime: Date.now(),
        });
      }
    };

    const unsubscribe = subscribeChatEventsFeed({
      createSource: () => chatService.createChatEventsSource(),
      onChatEvent,
      // Missed events while feed was down — refetch lists/caches and re-register streams.
      onResync: () => {
        void queryClient.invalidateQueries({ queryKey: [queryKeys.chats, 'infinite'] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
        void queryClient.invalidateQueries({ queryKey: ['chat'] });
        resyncActiveStreams(
          () => chatService.getActiveStreams(),
          () => cancelled,
          'useChatEvents',
        );
      },
      logContext: 'useChatEvents',
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled, queryClient]);
}
