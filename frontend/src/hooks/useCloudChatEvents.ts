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

// Full refetch is simpler than local's optimistic insert — cloud lists reorder server-side.
function invalidateCloudLists(queryClient: QueryClient): void {
  const { cloudUrl, connectedEmail } = useCloudSettingsStore.getState();
  void queryClient.invalidateQueries({ queryKey: queryKeys.cloudChatsAll });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.cloudWorkspaces(cloudUrl, connectedEmail),
  });
}

// Cloud twin of useChatEvents — VPS lifecycle SSE so remote creates/turns surface live.
export function useCloudChatEvents(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const cloudUrl = useCloudSettingsStore((state) => state.cloudUrl);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !cloudUrl) return;

    // Cancel in-flight resync on disconnect/VPS switch (same guard as useCloudStreamRestoration).
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
        // Single-chat cache for tabs/header; cloud sidebar is a separate list query.
        patchChatInCache(queryClient, parsed.chat_id, (chat) => ({
          ...chat,
          title: parsed.title,
        }));
        void queryClient.invalidateQueries({ queryKey: queryKeys.cloudChatsAll });
        return;
      }

      if (parsed.kind === 'stream_started') {
        // Mark cloud-owned before reconnect — turn may be on a chat this device never listed.
        markCloudChats([parsed.chat_id]);
        useUIStore.getState().openChatTab(parsed.chat_id);
        invalidateCloudLists(queryClient);
        void queryClient.invalidateQueries({ queryKey: queryKeys.chat(parsed.chat_id) });
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
      // Missed events while down; getActiveStreams also marks chat IDs cloud-owned.
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
