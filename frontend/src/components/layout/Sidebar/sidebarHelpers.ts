import toast from 'react-hot-toast';
import { DROPDOWN_WIDTH, DROPDOWN_HEIGHT, DROPDOWN_MARGIN } from '@/config/constants';
import { useChannelActivity } from '@/store/channelStore';
import type { Channel } from '@/types/channel.types';
import { chatStatusTone } from '@/utils/message';
import type { MachineBadge } from './SidebarChatItem';

export async function mutateWithToast<T>(
  mutateFn: () => Promise<T>,
  successMessage: string,
  failureMessage: string,
): Promise<T> {
  try {
    const result = await mutateFn();
    toast.success(successMessage);
    return result;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : failureMessage);
    throw error;
  }
}

export function calculateDropdownPosition(buttonRect: DOMRect): { top: number; left: number } {
  const isMobile = window.innerWidth < 640;
  const spaceBelow = window.innerHeight - buttonRect.bottom;
  const spaceRight = window.innerWidth - buttonRect.right;

  let top: number;
  let left: number;

  if (isMobile) {
    top =
      spaceBelow >= DROPDOWN_HEIGHT + DROPDOWN_MARGIN
        ? buttonRect.bottom + 4
        : buttonRect.top - DROPDOWN_HEIGHT - 4;
    left = buttonRect.right - DROPDOWN_WIDTH;
  } else {
    top =
      spaceBelow >= DROPDOWN_HEIGHT + DROPDOWN_MARGIN
        ? buttonRect.top
        : buttonRect.top - DROPDOWN_HEIGHT + buttonRect.height;
    left =
      spaceRight >= DROPDOWN_WIDTH + DROPDOWN_MARGIN
        ? buttonRect.right + 4
        : buttonRect.left - DROPDOWN_WIDTH - 4;
  }

  top = Math.max(
    DROPDOWN_MARGIN,
    Math.min(top, window.innerHeight - DROPDOWN_HEIGHT - DROPDOWN_MARGIN),
  );
  left = Math.max(
    DROPDOWN_MARGIN,
    Math.min(left, window.innerWidth - DROPDOWN_WIDTH - DROPDOWN_MARGIN),
  );

  return { top, left };
}

// For the hover preview: the row itself names no machine
export function describeMachine(machineBadge?: MachineBadge): string | undefined {
  if (!machineBadge) return undefined;
  return machineBadge.offline ? `${machineBadge.name} · offline` : machineBadge.name;
}

// Status of a channel row, top-level or nested: unread is moot while the channel is open
export function useChannelRowStatus(channel: Channel, isActive: boolean, isCompleted: boolean) {
  const activity = useChannelActivity(channel);
  const isUnread = !isActive && !!channel.unread;
  const status = chatStatusTone({
    blocked: activity.waiting_member_ids.length > 0,
    streaming: activity.member_ids.length > 0,
    completed: isCompleted,
    unread: isUnread,
  });
  return { status, isUnread };
}
