import { useEffect } from 'react';
import { apiClient } from '@/lib/api';
import { channelService } from '@/services/channelService';
import { streamConnection } from '@/services/streamConnection';
import { useChannelStore } from '@/store/channelStore';
import { logger } from '@/utils/logger';

// Streaming messages don't change seq, so resume just before the oldest one still open.
function catchUpCursor(channelId: string): number {
  const messages = Object.values(useChannelStore.getState().messagesByChannel[channelId] ?? {});
  const streamingSeqs = messages.filter((m) => m.status === 'streaming').map((m) => m.seq);
  if (streamingSeqs.length > 0) return Math.min(...streamingSeqs) - 1;
  return Math.max(0, ...messages.map((m) => m.seq));
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
    channelService
      .listMessages(channelId, catchUpCursor(channelId))
      .then((messages) => {
        if (!cancelled) useChannelStore.getState().mergeMessages(channelId, messages);
      })
      .catch((error) => logger.error('Channel catch-up failed', 'useChannelLive', error));
    return () => {
      cancelled = true;
    };
  }, [channelId, streamEpoch]);
}
