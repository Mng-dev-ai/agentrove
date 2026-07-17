import { useStreamStore } from '@/store/streamStore';
import { logger } from '@/utils/logger';
import type { ActiveStreamSnapshot } from '@/types/stream.types';

// Registers a backend's active-streams snapshot so sidebar/tab streaming
// indicators cover turns started while this client wasn't listening — startup
// restoration and post-gap SSE resyncs. Already-tracked streams are untouched.
export function registerActiveStreams(streams: ActiveStreamSnapshot[]): void {
  for (const stream of streams) {
    useStreamStore.getState().addStreamMetadataIfAbsent({
      chatId: stream.chat_id,
      messageId: stream.message_id,
      startTime: Date.now(),
    });
  }
}

// Post-gap resync for the SSE feeds: fetch the backend's snapshot and register
// it, skipping registration when the subscribing effect already tore down —
// a late response from a logged-out session or switched VPS must not write
// ghost metadata into the global store.
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
