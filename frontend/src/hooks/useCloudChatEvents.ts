import { useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { cloudChatService } from '@/services/cloudChatService';
import { patchChatInCache } from '@/hooks/queries/useChatQueries';
import { markCloudChats, markCloudSandboxes } from '@/utils/chatOrigin';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import { useUIStore } from '@/store/uiStore';
import { useStreamStore } from '@/store/streamStore';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { subscribeChatEventsFeed } from '@/utils/chatEventsFeed';
import { resyncActiveStreams } from '@/utils/activeStreams';
import { logger } from '@/utils/logger';
import type { ChatEvent } from '@/types/chat.types';

// Cloud lists reorder server-side and refetch on invalidation anyway, so a full
// refetch is simpler than the local feed's optimistic first-page insert.
function invalidateCloudLists(queryClient: QueryClient): void {
  const { cloudUrl, connectedEmail } = useCloudSettingsStore.getState();
  void queryClient.invalidateQueries({ queryKey: queryKeys.cloudChatsAll });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.cloudWorkspaces(cloudUrl, connectedEmail),
  });
}

// Cloud twin of useChatEvents: subscribes to the VPS's per-user chat lifecycle
// SSE feed so chats created and turns started on the VPS (agents, other devices)
// surface live instead of waiting for the next sidebar poll.
export function useCloudChatEvents(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const cloudUrl = useCloudSettingsStore((state) => state.cloudUrl);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !cloudUrl) return;

    // Guards in-flight resync snapshots across disconnect/VPS switch — a late
    // response from the old instance must not register ghost stream indicators
    // (same generation guard useCloudStreamRestoration uses).
    let cancelled = false;

    const onChatEvent = (event: MessageEvent) => {
      if (!event.data) return;
      let parsed: ChatEvent;
      try {
        parsed = JSON.parse(event.data) as ChatEvent;
      } catch (error) {
        logger.error('Malformed cloud chat event', 'useCloudChatEvents', error);
        return;
      }

      if (parsed.kind === 'chat_created') {
        const chat = parsed.chat;
        // Register origin before any consumer touches the chat — its reads,
        // status checks, and SSE reconnects must route to the VPS.
        markCloudChats([chat.id]);
        markCloudSandboxes([chat.sandbox_id]);
        queryClient.setQueryData(queryKeys.chat(chat.id), chat);
        if (chat.parent_chat_id) {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.subThreads(chat.parent_chat_id),
          });
        }
        invalidateCloudLists(queryClient);
        useUIStore.getState().openChatTab(chat.id);
        return;
      }

      if (parsed.kind === 'title_updated') {
        // Patch reaches the single-chat cache (tabs/header); cloud sidebar rows
        // live in their own list query, so refetch those.
        patchChatInCache(queryClient, parsed.chat_id, (chat) => ({
          ...chat,
          title: parsed.title,
        }));
        void queryClient.invalidateQueries({ queryKey: queryKeys.cloudChatsAll });
        return;
      }

      if (parsed.kind === 'stream_started') {
        // Out-of-band turns can hit chats this device never listed (e.g. fresh
        // sub-threads) — mark before the global watcher reconnects to them.
        markCloudChats([parsed.chat_id]);
        useUIStore.getState().openChatTab(parsed.chat_id);
        invalidateCloudLists(queryClient);
        // The turn also records its model/thinking/persona on the chat — drop
        // the cached detail so the toolbar seeds from what actually ran
        // instead of a copy cached before the turn (5-minute staleTime).
        void queryClient.invalidateQueries({ queryKey: queryKeys.chat(parsed.chat_id) });
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
      createSource: () => cloudChatService.createChatEventsSource(),
      onChatEvent,
      // Events published while the feed was down are lost — refetch the cloud
      // lists so chats created/renamed on the VPS during the gap surface,
      // refetch active per-chat caches (titles, sub-threads), and re-register
      // active streams so a missed stream_started still gets its running
      // indicator (connection-time restoration doesn't re-run).
      // getActiveStreams also marks the chat IDs cloud-owned before reconnect.
      onResync: () => {
        invalidateCloudLists(queryClient);
        void queryClient.invalidateQueries({ queryKey: ['chat'] });
        resyncActiveStreams(
          () => cloudChatService.getActiveStreams(),
          () => cancelled,
          'useCloudChatEvents',
        );
      },
      logContext: 'useCloudChatEvents',
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled, cloudUrl, queryClient]);
}
