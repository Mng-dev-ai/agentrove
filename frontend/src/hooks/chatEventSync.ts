import type { QueryClient } from '@tanstack/react-query';
import {
  invalidateSubThreadListsContaining,
  patchChatInCache,
} from '@/hooks/queries/useChatQueries';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { insertStartedTurnInCache } from '@/hooks/stream/cachePatch';
import type { AuthEventSource } from '@/services/authEventSource';
import { useStreamStore } from '@/store/streamStore';
import { useUIStore } from '@/store/uiStore';
import { resyncActiveStreams } from '@/utils/activeStreams';
import { subscribeChatEventsFeed } from '@/utils/chatEventsFeed';
import { logger } from '@/utils/logger';
import type { Chat, ChatEvent } from '@/types/chat.types';
import type { ActiveStreamSnapshot } from '@/types/stream.types';

// What a backend (local, or one paired machine) contributes to chat-event handling;
// everything else in this file is shared by every origin.
export interface ChatEventOrigin {
  machineId: string;
  logContext: string;
  createSource: () => Promise<AuthEventSource>;
  getActiveStreams: () => Promise<ActiveStreamSnapshot[]>;
  // False drops the event. May first record the event's chat as belonging to this origin.
  claim: (event: ChatEvent) => boolean;
  applyCreatedChat: (chat: Chat) => void;
  invalidateChatLists: () => void;
  // Lists patchChatInCache cannot rename in place.
  invalidateRenamedChatLists: () => void;
}

function applyChatEvent(
  queryClient: QueryClient,
  origin: ChatEventOrigin,
  event: MessageEvent,
): void {
  if (!event.data) return;
  let parsed: ChatEvent;
  try {
    parsed = JSON.parse(event.data) as ChatEvent;
  } catch (error) {
    logger.error('Malformed chat event', origin.logContext, error);
    return;
  }
  if (!origin.claim(parsed)) return;

  if (parsed.kind === 'channel_created') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.channels(origin.machineId) });
    return;
  }

  if (parsed.kind === 'chat_created') {
    origin.applyCreatedChat(parsed.chat);
    useUIStore.getState().openChatTab(parsed.chat.id);
    return;
  }

  if (parsed.kind === 'title_updated') {
    // Mid-stream title backfill — patch caches so sidebar/tab rename without refetch.
    patchChatInCache(queryClient, parsed.chat_id, (chat) => ({
      ...chat,
      title: parsed.title,
    }));
    invalidateSubThreadListsContaining(queryClient, parsed.chat_id);
    origin.invalidateRenamedChatLists();
    return;
  }

  if (parsed.kind === 'stream_started') {
    // Out-of-band turns on existing chats skip chat_created — open the tab here.
    useUIStore.getState().openChatTab(parsed.chat_id);
    // Server bumps updated_at — refetch so chats outside loaded pages surface.
    origin.invalidateChatLists();
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat(parsed.chat_id) });
    if (parsed.parent_chat_id) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.subThreads(parsed.parent_chat_id),
      });
    }
    insertStartedTurnInCache(queryClient, parsed);
    // Self-starts already have addStream; settled orphans pruned by useGlobalStream.
    useStreamStore.getState().addStreamMetadataIfAbsent({
      chatId: parsed.chat_id,
      messageId: parsed.message_id,
      startTime: Date.now(),
    });
  }
}

// Per-user chat lifecycle SSE: out-of-band creates/turns (MCP, agents) surface live.
export function subscribeChatEvents(queryClient: QueryClient, origin: ChatEventOrigin): () => void {
  // Guards in-flight resync snapshots across teardown (logout flips enabled) —
  // a late response must not register ghost stream indicators.
  let cancelled = false;

  const unsubscribe = subscribeChatEventsFeed({
    createSource: origin.createSource,
    onChatEvent: (event) => applyChatEvent(queryClient, origin, event),
    // Missed events while feed was down — refetch lists/caches and re-register streams.
    onResync: () => {
      origin.invalidateChatLists();
      void queryClient.invalidateQueries({ queryKey: ['chat'] });
      resyncActiveStreams(origin.getActiveStreams, () => cancelled, origin.logContext);
    },
    logContext: origin.logContext,
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
}
