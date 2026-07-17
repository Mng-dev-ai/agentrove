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

// Subscribes to the backend's per-user chat lifecycle SSE feed so chats created
// and turns started out-of-band (e.g. by agents via the MCP server) surface
// live — sidebar entry, chat tab, and running indicator — without a refresh.
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
        // Backfilled mid-stream by the background titling task — patch caches
        // directly so the sidebar/tab rename without waiting for a refetch.
        patchChatInCache(queryClient, parsed.chat_id, (chat) => ({
          ...chat,
          title: parsed.title,
        }));
        return;
      }

      if (parsed.kind === 'stream_started') {
        // Turns started out-of-band on existing chats emit no chat_created,
        // so the running chat must join the tab strip here.
        useUIStore.getState().openChatTab(parsed.chat_id);
        // The turn bumps updated_at ordering server-side — refetch the sidebar
        // lists so the chat surfaces even from outside the loaded pages.
        queryClient.invalidateQueries({ queryKey: [queryKeys.chats, 'infinite'] });
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
        // Self-started turns are already tracked via addStream; settled turns
        // are cleaned up by useGlobalStream's orphan pruning.
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
      // Events published while the feed was down are lost — refetch the sidebar
      // lists, refetch active per-chat caches (titles, sub-threads, context
      // usage — the live path patches those directly), and re-register active
      // streams so a missed stream_started still gets its running indicator
      // (startup restoration only runs once).
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
