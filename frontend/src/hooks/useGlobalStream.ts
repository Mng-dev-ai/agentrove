import { useEffect, useRef } from 'react';
import { logger } from '@/utils/logger';
import { useStreamStore } from '@/store/streamStore';
import { syncChatStatus } from '@/services/chatStatusSync';
import { useElicitationStore } from '@/store/elicitationStore';
import { usePermissionStore } from '@/store/permissionStore';
import { pruneIfStillOrphan } from '@/utils/activeStreams';

interface UseGlobalStreamOptions {
  enabled?: boolean;
  onPruneComplete?: () => void;
}

const STREAM_PRUNE_INTERVAL_MS = 5000;

function isChatBlocked(chatId: string): boolean {
  return (
    usePermissionStore.getState().pendingRequests.has(chatId) ||
    useElicitationStore.getState().pendingRequests.has(chatId)
  );
}

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
          // Also records pending approvals/questions: an unopened chat has no other feed
          // for them. A foreground stream attaching mid-probe owns them from then on.
          const status = await syncChatStatus(
            streamMeta.chatId,
            () => !cancelled && !useStreamStore.getState().getStreamByChat(streamMeta.chatId),
          );
          if (cancelled) return;

          if (!status?.has_active_task) {
            pruneIfStillOrphan(streamMeta.chatId, true);
          }
        } catch (error) {
          logger.error('Stream prune check failed', 'useGlobalStream', error);
          // A blocked chat stays tracked: only a later successful probe can clear
          // approvals answered elsewhere.
          if (!isChatBlocked(streamMeta.chatId)) pruneIfStillOrphan(streamMeta.chatId, false);
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
