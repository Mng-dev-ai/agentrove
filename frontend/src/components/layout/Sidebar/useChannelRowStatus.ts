import { useChannelActivity } from '@/store/channelStore';
import type { Channel } from '@/types/channel.types';
import { chatStatusTone } from '@/utils/message';
import { channelActivityKind } from './sidebarGrouping';

// Status of a channel row, top-level or nested, from the same rule as the activity
// pills; unread is moot while the channel is open.
export function useChannelRowStatus(channel: Channel, isActive: boolean, isCompleted: boolean) {
  const kind = channelActivityKind(useChannelActivity(channel));
  const isUnread = !isActive && !!channel.unread;
  const status = chatStatusTone({
    blocked: kind === 'needs-you',
    streaming: kind === 'running',
    completed: isCompleted,
    unread: isUnread,
  });
  return { status, isUnread };
}
