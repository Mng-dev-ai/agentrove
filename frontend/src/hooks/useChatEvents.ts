import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { chatService } from '@/services/chatService';
import { applyCreatedChat } from '@/hooks/queries/useChatQueries';
import { useUIStore } from '@/store/uiStore';
import { useStreamStore } from '@/store/streamStore';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { logger } from '@/utils/logger';
import type { Chat } from '@/types/chat.types';

type ChatEvent =
  | { kind: 'chat_created'; chat: Chat }
  | { kind: 'stream_started'; chat_id: string; message_id: string };

// Subscribes to the backend's per-user chat lifecycle SSE feed so chats created
// and turns started out-of-band (e.g. by agents via the MCP server) surface
// live — sidebar entry, chat tab, and running indicator — without a refresh.
export function useChatEvents(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    let source: EventSource;
    try {
      source = chatService.createChatEventsSource();
    } catch (error) {
      logger.error('Chat events stream failed to open', 'useChatEvents', error);
      return;
    }

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

      if (parsed.kind === 'stream_started') {
        // Turns started out-of-band on existing chats emit no chat_created,
        // so the running chat must join the tab strip here.
        useUIStore.getState().openChatTab(parsed.chat_id);
        // The turn bumps updated_at ordering server-side — refetch the sidebar
        // lists so the chat surfaces even from outside the loaded pages.
        queryClient.invalidateQueries({ queryKey: [queryKeys.chats, 'infinite'] });
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
        const store = useStreamStore.getState();
        // Skip chats already tracked (self-started turns register via addStream).
        // Settled turns are cleaned up by useGlobalStream's orphan pruning.
        if (store.activeStreamMetadata.some((meta) => meta.chatId === parsed.chat_id)) return;
        store.addStreamMetadata({
          chatId: parsed.chat_id,
          messageId: parsed.message_id,
          startTime: Date.now(),
        });
      }
    };

    // EventSource handles transient-error reconnects itself; no error handler needed.
    // Custom event names hit the generic EventTarget overload, which takes Event.
    source.addEventListener('chat_event', (event: Event) => onChatEvent(event as MessageEvent));
    return () => source.close();
  }, [enabled, queryClient]);
}
