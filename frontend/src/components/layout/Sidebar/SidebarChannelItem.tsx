import { useState, type MouseEvent } from 'react';
import { Hash } from 'lucide-react';
import { AsciiSpinner } from '@/components/ui/AsciiSpinner/AsciiSpinner';
import { ChatStatusDot } from '@/components/ui/ChatStatusDot/ChatStatusDot';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { useChannelActivity } from '@/store/channelStore';
import { getRelativeTime } from '@/utils/date';
import { chatStatusTone, CHAT_STATUS_LABEL } from '@/utils/message';
import type { Channel } from '@/types/channel.types';
import { SidebarRow, SidebarRowTitle } from './SidebarRow';
import { SidebarRowBadges, type MachineBadge } from './SidebarChatItem';
import styles from './SidebarChannelItem.module.scss';

interface SidebarChannelItemProps {
  channel: Channel;
  machineBadge: MachineBadge | undefined;
  isActive: boolean;
  isCompleted: boolean;
  isDropdownOpen: boolean;
  onSelect: (channelId: string) => void;
  onDropdownClick: (e: MouseEvent<HTMLButtonElement>, channel: Channel) => void;
}

export function SidebarChannelItem({
  channel,
  machineBadge,
  isActive,
  isCompleted,
  isDropdownOpen,
  onSelect,
  onDropdownClick,
}: SidebarChannelItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const activity = useChannelActivity(channel);
  const isUnread = !isActive && !!channel.unread;
  const status = chatStatusTone({
    blocked: activity.waiting_member_ids.length > 0,
    streaming: activity.member_ids.length > 0,
    completed: isCompleted,
    unread: isUnread,
  });
  const icon = (
    <span className={styles['status-slot']}>
      {status === 'running' ? (
        <AsciiSpinner className={styles.spinner} />
      ) : (
        <Hash className={styles.icon} />
      )}
      {status && status !== 'running' && (
        <ChatStatusDot
          tone={status}
          className={styles['status-corner']}
          ringClassName={styles['status-ring']}
        />
      )}
    </span>
  );

  return (
    <SidebarRow
      isActive={isActive}
      isRevealed={isHovered || isActive || isDropdownOpen}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      leading={
        status ? (
          <FloatingTooltip content={CHAT_STATUS_LABEL[status]} className={styles['status-tooltip']}>
            {icon}
          </FloatingTooltip>
        ) : (
          icon
        )
      }
      title={
        <FloatingTooltip
          content={channel.members.map((member) => member.display_name).join(', ')}
          className={styles['title-tooltip']}
        >
          <SidebarRowTitle
            label={channel.name}
            isEmphasized={isActive || isUnread}
            isCurrent={isActive}
            onClick={() => onSelect(channel.id)}
          />
        </FloatingTooltip>
      }
      subtitle={
        <SidebarRowBadges
          machineName={machineBadge?.name}
          machineOffline={machineBadge?.offline}
          isIndented
        />
      }
      timestamp={getRelativeTime(channel.updated_at)}
      dropdownLabel="Channel options"
      onDropdownClick={(e) => onDropdownClick(e, channel)}
    />
  );
}
