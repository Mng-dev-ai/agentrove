import { useStreamStore } from '@/store/streamStore';
import { logger } from '@/utils/logger';
import type { ActiveStreamSnapshot } from '@/types/stream.types';

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
