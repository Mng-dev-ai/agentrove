import { useStreamStore } from '@/store/streamStore';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { logger } from '@/utils/logger';
import type { ActiveStreamSnapshot } from '@/types/stream.types';

// Re-check before remove — an EventSource may attach while the status request is in flight.
export function pruneIfStillOrphan(chatId: string, markDone: boolean): void {
  const store = useStreamStore.getState();
  if (store.getStreamByChat(chatId)) return;
  if (!store.activeStreamMetadata.some((meta) => meta.chatId === chatId)) return;
  store.removeStreamMetadata(chatId);
  // Orphans have no complete envelope; only confirmed-settled prune earns the Done badge
  // (a failed status probe is a guess, not evidence of completion).
  if (markDone) store.markCompleted(chatId);
  void queryClient.invalidateQueries({ queryKey: queryKeys.messages(chatId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.chat(chatId), exact: true });
}

// Register backend snapshot for turns started while offline (startup/resync).
// Already-tracked streams are left alone.
export function registerActiveStreams(streams: ActiveStreamSnapshot[]): void {
  for (const stream of streams) {
    useStreamStore.getState().addStreamMetadataIfAbsent({
      chatId: stream.chat_id,
      messageId: stream.message_id,
      startTime: Date.now(),
    });
  }
}

// Fetch snapshot after an SSE gap; skip if the subscriber already unmounted.
export function resyncActiveStreams(
  getStreams: () => Promise<ActiveStreamSnapshot[]>,
  isCancelled: () => boolean,
  logContext: string,
): void {
  getStreams()
    .then((streams) => {
      if (!isCancelled()) registerActiveStreams(streams);
    })
    .catch((error: unknown) => {
      logger.error('Active stream resync failed', logContext, error);
    });
}
