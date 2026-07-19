import { useEffect, useRef } from 'react';
import { logger } from '@/utils/logger';
import { useStreamStore } from '@/store/streamStore';
import { chatService } from '@/services/chatService';

interface UseGlobalStreamOptions {
  enabled?: boolean;
  onPruneComplete?: () => void;
}

const STREAM_PRUNE_INTERVAL_MS = 5000;

// Re-check before remove — an EventSource may attach while the status request is in flight.
function pruneIfStillOrphan(chatId: string, markDone: boolean): void {
  const store = useStreamStore.getState();
  if (!store.getStreamByChat(chatId)) {
    store.removeStreamMetadata(chatId);
    // Orphans have no complete envelope; only confirmed-settled prune earns the Done badge
    // (a failed status probe is a guess, not evidence of completion).
    if (markDone) store.markCompleted(chatId);
  }
}

// Interval reconcile: background sub-threads register metadata without an EventSource,
// so removeStream never fires for them — prune settled orphans so indicators clear.
export function useGlobalStream(options?: UseGlobalStreamOptions) {
  const hasPrunedRef = useRef(false);
  const enabled = options?.enabled ?? true;
  const onPruneComplete = options?.onPruneComplete;

  useEffect(() => {
    if (!enabled) return;

    const pruneStaleStreams = async () => {
      const store = useStreamStore.getState();
      // Only orphans — pruning a live EventSource would tear down a foreground stream.
      const orphans = store.activeStreamMetadata.filter(
        (meta) => !store.getStreamByChat(meta.chatId),
      );

      if (orphans.length === 0) return;

      const prunePromises = orphans.map(async (streamMeta) => {
        try {
          const status = await chatService.checkChatStatus(streamMeta.chatId);

          if (!status?.has_active_task) {
            pruneIfStillOrphan(streamMeta.chatId, true);
          }
        } catch (error) {
          logger.error('Stream prune check failed', 'useGlobalStream', error);
          pruneIfStillOrphan(streamMeta.chatId, false);
        }
      });

      await Promise.allSettled(prunePromises);

      if (!hasPrunedRef.current) {
        hasPrunedRef.current = true;
        onPruneComplete?.();
      }
    };

    const initialTimeout = setTimeout(pruneStaleStreams, 500);
    const intervalId = setInterval(pruneStaleStreams, STREAM_PRUNE_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(intervalId);
    };
  }, [enabled, onPruneComplete]);
}
