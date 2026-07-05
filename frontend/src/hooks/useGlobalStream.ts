import { useEffect, useRef } from 'react';
import { logger } from '@/utils/logger';
import { useStreamStore } from '@/store/streamStore';
import { chatService } from '@/services/chatService';

interface UseGlobalStreamOptions {
  enabled?: boolean;
  onPruneComplete?: () => void;
}

const STREAM_PRUNE_INTERVAL_MS = 5000;

// Re-check liveness immediately before removing — a live EventSource may have
// attached (user opened/reconnected the sub-thread) while the status request was
// in flight, and removeStreamMetadata would tear it down. Such streams self-clean
// via removeStream on completion, so skip them.
function pruneIfStillOrphan(chatId: string, markDone: boolean): void {
  const store = useStreamStore.getState();
  if (!store.getStreamByChat(chatId)) {
    store.removeStreamMetadata(chatId);
    // Orphan streams have no EventSource, so no complete envelope ever fires —
    // the confirmed-settled prune is their only Done signal. A failed status
    // probe is a cleanup guess, not evidence the turn completed, so it doesn't
    // earn the badge.
    if (markDone) store.markCompleted(chatId);
  }
}

// Reconciles the in-memory stream store with the server, pruning metadata whose
// backend task has settled so the UI stops showing stale "streaming" indicators.
// Runs on an interval (not just at mount) because background sub-threads — e.g.
// stream actions — register metadata without opening a client EventSource, so
// the normal removeStream cleanup never fires for them.
export function useGlobalStream(options?: UseGlobalStreamOptions) {
  const hasPrunedRef = useRef(false);
  const enabled = options?.enabled ?? true;
  const onPruneComplete = options?.onPruneComplete;

  useEffect(() => {
    if (!enabled) return;

    const pruneStaleStreams = async () => {
      const store = useStreamStore.getState();
      // Only reconcile orphan metadata (no live EventSource). Entries with an
      // active stream self-clean via removeStream on the completion event —
      // pruning them here would tear down a live foreground stream at its
      // completion boundary.
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
