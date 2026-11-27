import { useState, type MouseEvent } from 'react';
import { AsciiSpinner } from '@/components/ui/AsciiSpinner/AsciiSpinner';
import { ChatStatusDot } from '@/components/ui/ChatStatusDot/ChatStatusDot';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { ProviderIconStack } from '@/components/ui/icons/ProviderIconStack';
import { getRelativeTime } from '@/utils/date';
import { CHAT_STATUS_LABEL } from '@/utils/message';
import type { Channel } from '@/types/channel.types';
import type { AgentKind } from '@/types/chat.types';
import { SidebarRow, SidebarRowTitle } from './SidebarRow';
import { SidebarRowPreview, type MachineBadge } from './SidebarChatItem';
import { describeMachine } from './sidebarHelpers';
import { useChannelRowStatus } from './useChannelRowStatus';
import styles from './SidebarChannelItem.module.scss';

interface SidebarChannelItemProps {
  channel: Channel;
  agentKinds: AgentKind[];
  machineBadge: MachineBadge | undefined;
  isActive: boolean;
  isCompleted: boolean;
  isDropdownOpen: boolean;
  onSelect: (channelId: string) => void;
  onDropdownClick: (e: MouseEvent<HTMLButtonElement>, channel: Channel) => void;
}

export function SidebarChannelItem({
  channel,
  agentKinds,
  machineBadge,
  isActive,
  isCompleted,
  isDropdownOpen,
  onSelect,
  onDropdownClick,
}: SidebarChannelItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const { status, isUnread } = useChannelRowStatus(channel, isActive, isCompleted);
  const statusLabel = status ? CHAT_STATUS_LABEL[status] : undefined;
  const preview = (
    <SidebarRowPreview
      title={channel.name}
      detail={[`Updated ${getRelativeTime(channel.updated_at)}`, statusLabel]
        .filter(Boolean)
        .join(' · ')}
      facts={[
        ['Machine', describeMachine(machineBadge)],
        ['Members', channel.members.map((member) => member.display_name).join(', ')],
      ]}
    />
  );

  return (
    <FloatingTooltip content={preview} placement="right">
      <SidebarRow
        isActive={isActive}
        isRevealed={isHovered || isActive || isDropdownOpen}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        leading={
          <span className={styles.leading}>
            <span
              className={styles['status-slot']}
              role={statusLabel ? 'img' : undefined}
              aria-label={statusLabel}
            >
              {status === 'running' ? (
                <AsciiSpinner className={styles.spinner} />
              ) : (
                <ProviderIconStack agentKinds={agentKinds} />
              )}
              {status && status !== 'running' && (
                <ChatStatusDot
                  tone={status}
                  className={styles['status-corner']}
                  ringClassName={styles['status-ring']}
                />
              )}
            </span>
            <span
              className={styles['member-count']}
              aria-label={`${channel.members.length} members`}
            >
              {channel.members.length}
            </span>
          </span>
        }
        title={
          <SidebarRowTitle
            label={channel.name}
            isEmphasized={isActive || isUnread}
            isCurrent={isActive}
            onClick={() => onSelect(channel.id)}
          />
        }
        timestamp={getRelativeTime(channel.updated_at)}
        dropdownLabel="Channel options"
        onDropdownClick={(e) => onDropdownClick(e, channel)}
      />
    </FloatingTooltip>
  );
}
