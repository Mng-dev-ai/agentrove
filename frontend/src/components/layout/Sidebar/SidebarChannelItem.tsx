import { useState, type MouseEvent } from 'react';
import { Hash } from 'lucide-react';
import { getRelativeTime } from '@/utils/date';
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

  return (
    <SidebarRow
      isActive={isActive}
      isRevealed={isHovered || isActive || isDropdownOpen}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      leading={<Hash className={styles.icon} />}
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
