import { useEffect } from 'react';
import { channelService } from '@/services/channelService';
import { useChannelStore } from '@/store/channelStore';
import { logger } from '@/utils/logger';

function highestSeq(channelId: string): number {
  const messages = useChannelStore.getState().messagesByChannel[channelId];
  return messages ? Math.max(0, ...Object.values(messages).map((message) => message.seq)) : 0;
}

// Channel envelopes carry no seq: catch up by refetching past the highest seq held on
// mount and after every SSE (re)open, merging by id.
export function useChannelLive(channelId: string) {
  const streamEpoch = useChannelStore((state) => state.streamEpoch);

  useEffect(() => {
    useChannelStore.getState().setOpenChannel(channelId);
    return () => useChannelStore.getState().setOpenChannel(null);
  }, [channelId]);

  useEffect(() => {
    let cancelled = false;
    channelService
      .listMessages(channelId, highestSeq(channelId))
      .then((messages) => {
        if (!cancelled) useChannelStore.getState().mergeMessages(channelId, messages);
      })
      .catch((error) => logger.error('Channel catch-up failed', 'useChannelLive', error));
    return () => {
      cancelled = true;
    };
  }, [channelId, streamEpoch]);
}
