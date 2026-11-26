import { useEffect, useRef } from 'react';
import { logger } from '@/utils/logger';
import { useStreamStore } from '@/store/streamStore';
import { syncChatStatus } from '@/services/chatStatusSync';
import { pruneIfStillOrphan } from '@/utils/activeStreams';

interface UseGlobalStreamOptions {
  enabled?: boolean;
  onPruneComplete?: () => void;
}

const STREAM_PRUNE_INTERVAL_MS = 5000;

// Interval reconcile: background sub-threads register metadata without an EventSource,
// so removeStream never fires for them — prune settled orphans so indicators clear.
export function useGlobalStream(options?: UseGlobalStreamOptions) {
  const hasPrunedRef = useRef(false);
  const enabled = options?.enabled ?? true;
  const onPruneComplete = options?.onPruneComplete;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const pruneStaleStreams = async () => {
      const store = useStreamStore.getState();
      // Only orphans — pruning a live EventSource would tear down a foreground stream.
      const orphans = store.activeStreamMetadata.filter(
        (meta) => !store.getStreamByChat(meta.chatId),
      );

      if (orphans.length === 0) return;

      const prunePromises = orphans.map(async (streamMeta) => {
        try {
          // Also records pending approvals/questions: an unopened chat has no other
          // feed for them, and the sidebar's Needs-you state reads those stores.
          const status = await syncChatStatus(streamMeta.chatId, () => !cancelled);
          if (cancelled) return;

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
      cancelled = true;
      clearTimeout(initialTimeout);
      clearInterval(intervalId);
    };
  }, [enabled, onPruneComplete]);
}
