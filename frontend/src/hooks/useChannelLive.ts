import { useCallback, useEffect, useState } from 'react';
import { markChannelViewed } from '@/hooks/queries/useChannelQueries';
import { MESSAGE_PAGE_SIZE } from '@/hooks/queries/useChatQueries';
import { resolveChannelClient } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { channelService } from '@/services/channelService';
import '@/services/streamService';
import { streamConnection } from '@/services/streamConnection';
import { useChannelStore } from '@/store/channelStore';
import { useChannelQueueStore } from '@/store/messageQueueStore';
import { logger } from '@/utils/logger';

const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;

// Streaming messages don't change seq, so resume just before the oldest one still open.
function catchUpPage(channelId: string) {
  const slice = useChannelStore.getState().channels[channelId];
  if (!slice?.synced) return { limit: MESSAGE_PAGE_SIZE };
  const streamingSeqs = Object.values(slice.messages)
    .filter((message) => message.status === 'streaming')
    .map((message) => message.seq);
  return {
    after_seq: Math.max(0, Math.min(slice.syncedSeq, ...streamingSeqs.map((seq) => seq - 1))),
  };
}

export function useChannelLive(channelId: string) {
  const streamEpoch = useChannelStore((state) => state.streamEpoch);
  const olderBeforeSeq = useChannelStore(
    (state) => state.channels[channelId]?.olderBeforeSeq ?? null,
  );
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);

  useEffect(() => {
    useChannelStore.getState().holdChannel(channelId);
    const release = streamConnection.retain(resolveChannelClient(channelId));
    return () => {
      release();
      useChannelStore.getState().releaseChannel(channelId);
    };
  }, [channelId]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const catchUp = (delayMs: number) => {
      const token = useChannelStore.getState().beginPermissionSync(channelId);
      void useChannelQueueStore.getState().fetchQueue(channelId);
      Promise.all([
        channelService.listMessages(channelId, catchUpPage(channelId)),
        channelService.listPermissions(channelId),
        channelService.getMemberActivity(channelId),
      ])
        .then(([messages, permissions, activity]) => {
          if (cancelled) return;
          useChannelStore.getState().syncMessages(channelId, messages);
          useChannelStore.getState().syncPermissions(channelId, token, permissions);
          useChannelStore.getState().syncActivity(channelId, activity);
          void markChannelViewed(queryClient, channelId);
        })
        .catch((error) => {
          if (cancelled) return;
          logger.error('Channel catch-up failed', 'useChannelLive', error);
          retryTimer = setTimeout(
            () => catchUp(Math.min(delayMs * 2, RETRY_MAX_DELAY_MS)),
            delayMs,
          );
        });
    };
    catchUp(RETRY_BASE_DELAY_MS);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [channelId, streamEpoch]);

  const fetchNextPage = useCallback(() => {
    if (olderBeforeSeq === null) return;
    setIsFetchingNextPage(true);
    channelService
      .listMessages(channelId, { before_seq: olderBeforeSeq, limit: MESSAGE_PAGE_SIZE })
      .then((messages) => useChannelStore.getState().syncOlderMessages(channelId, messages))
      .catch((error) =>
        logger.error('Loading older channel messages failed', 'useChannelLive', error),
      )
      .finally(() => setIsFetchingNextPage(false));
  }, [channelId, olderBeforeSeq]);

  return { hasNextPage: olderBeforeSeq !== null, isFetchingNextPage, fetchNextPage };
}
