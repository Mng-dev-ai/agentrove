import { useEffect } from 'react';
import { apiClient } from '@/lib/api';
import { channelService } from '@/services/channelService';
import '@/services/streamService';
import { streamConnection } from '@/services/streamConnection';
import { useChannelStore } from '@/store/channelStore';
import { logger } from '@/utils/logger';

const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30000;

// Streaming messages don't change seq, so resume just before the oldest one still open.
function catchUpCursor(channelId: string): number {
  const slice = useChannelStore.getState().channels[channelId];
  if (!slice) return 0;
  const streamingSeqs = Object.values(slice.messages)
    .filter((message) => message.status === 'streaming')
    .map((message) => message.seq);
  return Math.max(0, Math.min(slice.syncedSeq, ...streamingSeqs.map((seq) => seq - 1)));
}

export function useChannelLive(channelId: string) {
  const streamEpoch = useChannelStore((state) => state.streamEpoch);

  useEffect(() => {
    useChannelStore.getState().holdChannel(channelId);
    const release = streamConnection.retain(apiClient);
    return () => {
      release();
      useChannelStore.getState().releaseChannel(channelId);
    };
  }, [channelId]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const catchUp = (delayMs: number) => {
      channelService
        .listMessages(channelId, catchUpCursor(channelId))
        .then((messages) => {
          if (!cancelled) useChannelStore.getState().syncMessages(channelId, messages);
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
}
