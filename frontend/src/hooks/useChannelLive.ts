import { useEffect } from 'react';
import { apiClient } from '@/lib/api';
import { channelService } from '@/services/channelService';
import '@/services/streamService';
import { streamConnection } from '@/services/streamConnection';
import { useChannelStore } from '@/store/channelStore';
import { logger } from '@/utils/logger';

// Streaming messages don't change seq, so resume just before the oldest one still open.
function catchUpCursor(channelId: string): number {
  const slice = useChannelStore.getState().channels[channelId];
  if (!slice) return 0;
  const streamingSeqs = Object.values(slice.messages)
    .filter((message) => message.status === 'streaming')
    .map((message) => message.seq);
  return Math.min(slice.syncedSeq, ...streamingSeqs.map((seq) => seq - 1));
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
    const afterSeq = Math.max(0, catchUpCursor(channelId));
    const requestClock = useChannelStore.getState().liveClock;
    channelService
      .listMessages(channelId, afterSeq)
      .then((messages) => {
        if (!cancelled) {
          useChannelStore.getState().syncMessages(channelId, afterSeq, messages, requestClock);
        }
      })
      .catch((error) => logger.error('Channel catch-up failed', 'useChannelLive', error));
    return () => {
      cancelled = true;
    };
  }, [channelId, streamEpoch]);
}
