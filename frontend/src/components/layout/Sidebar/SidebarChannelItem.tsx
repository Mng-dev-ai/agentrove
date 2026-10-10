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
import styles from './SidebarChannelItem.module.scss';

interface SidebarChannelItemProps {
  channel: Channel;
  isActive: boolean;
  isDropdownOpen: boolean;
  onSelect: (channelId: string) => void;
  onDropdownClick: (e: MouseEvent<HTMLButtonElement>, channel: Channel) => void;
}

export function SidebarChannelItem({
  channel,
  isActive,
  isDropdownOpen,
  onSelect,
  onDropdownClick,
}: SidebarChannelItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const activity = useChannelActivity(channel);
  const status = chatStatusTone({
    blocked: activity.waiting_member_ids.length > 0,
    streaming: activity.member_ids.length > 0,
    completed: false,
  });
  const icon = (
    <span className={styles['status-slot']}>
      {status === 'running' ? (
        <AsciiSpinner className={styles.spinner} />
      ) : (
        <Hash className={styles.icon} />
      )}
      {status === 'blocked' && (
        <ChatStatusDot
          tone="blocked"
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
        <SidebarRowTitle
          label={channel.name}
          isEmphasized={isActive}
          isCurrent={isActive}
          onClick={() => onSelect(channel.id)}
        />
      }
      subtitle={
        <span className={styles.members}>
          {channel.members.map((member) => member.display_name).join(', ')}
        </span>
      }
      timestamp={getRelativeTime(channel.updated_at)}
      dropdownLabel="Channel options"
      onDropdownClick={(e) => onDropdownClick(e, channel)}
    />
  );
}
