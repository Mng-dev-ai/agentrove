import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useSubThreadsQuery } from '@/hooks/queries/useChatQueries';
import { useChatAgentKind } from '@/hooks/useChatAgentKind';
import { AsciiSpinner } from '@/components/ui/AsciiSpinner/AsciiSpinner';
import { ChatStatusDot } from '@/components/ui/ChatStatusDot/ChatStatusDot';
import { chatStatusTone, CHAT_STATUS_LABEL, type ChatStatusTone } from '@/utils/message';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import clsx from 'clsx';
import { stripMarkdownTitle } from '@/utils/format';
import { getRelativeTime } from '@/utils/date';
import { stateClasses } from '@/config/stateClasses';
import type { Channel } from '@/types/channel.types';
import type { AgentKind, Chat } from '@/types/chat.types';
import { ChannelRowLeading } from './SidebarChannelItem';
import { useChannelRowStatus } from './useChannelRowStatus';
import type { MachineChannel } from './sidebarGrouping';
import type { SidebarChannelActions } from './useSidebarChannelActions';
import styles from './SubThreadList.module.scss';

const COLLAPSED_ROW_LIMIT = 5;

interface NestedRowProps {
  isActive: boolean;
  isCurrent: boolean;
  isRevealed: boolean;
  isEmphasized: boolean;
  leading: ReactNode;
  title: string;
  tooltip: string;
  timestamp: string;
  dropdownLabel: string;
  onSelect: () => void;
  onDropdownClick: (e: MouseEvent<HTMLButtonElement>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

// Nested counterpart of SidebarRow, shared by sub-thread and linked channel rows.
function NestedRow({
  isActive,
  isCurrent,
  isRevealed,
  isEmphasized,
  leading,
  title,
  tooltip,
  timestamp,
  dropdownLabel,
  onSelect,
  onDropdownClick,
  onMouseEnter,
  onMouseLeave,
}: NestedRowProps) {
  // Keep the active row visible when navigation lands on an off-screen row
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isActive) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isActive]);
  return (
    <div
      ref={rowRef}
      className={clsx(styles['subthread-row'], isActive && stateClasses.ACTIVE)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={styles.connector} />

      <FloatingTooltip content={tooltip} className={styles['thread-tooltip']}>
        <Button
          variant="unstyled"
          type="button"
          onClick={onSelect}
          aria-current={isCurrent ? 'page' : undefined}
          className={styles['subthread-select']}
        >
          {leading}
          <span className={clsx(styles.title, isEmphasized && styles['title--emphasis'])}>
            {title}
          </span>
        </Button>
      </FloatingTooltip>

      {/* The timestamp yields to the dropdown on reveal */}
      <span className={clsx(styles.timestamp, isRevealed && styles['timestamp--hidden'])}>
        {timestamp}
      </span>

      <Button
        onClick={onDropdownClick}
        onMouseDown={(e) => e.stopPropagation()}
        variant="unstyled"
        className={clsx(styles['dropdown-btn'], isRevealed && styles['dropdown-btn--visible'])}
        aria-label={dropdownLabel}
      >
        <MoreHorizontal className={styles['dropdown-icon']} />
      </Button>
    </div>
  );
}

interface SubThreadLeadingProps {
  icon: ReactNode;
  status: ChatStatusTone | null;
  isRevealed: boolean;
}

// Same status language as top-level rows: red dot = needs you, braille spinner =
// running, green dot = done, persistent on the leading icon (visible on hover).
function SubThreadLeading({ icon, status, isRevealed }: SubThreadLeadingProps) {
  if (icon == null && status == null) return null;
  const statusLabel = status ? CHAT_STATUS_LABEL[status] : undefined;
  return (
    <span
      className={styles['leading-slot']}
      role={statusLabel ? 'img' : undefined}
      aria-label={statusLabel}
    >
      {status === 'running' ? (
        <AsciiSpinner className={styles['subthread-spinner']} />
      ) : (
        icon != null && (
          <span
            className={clsx(styles['leading-icon'], !isRevealed && styles['leading-icon--muted'])}
          >
            {icon}
          </span>
        )
      )}
      {status && status !== 'running' && (
        <ChatStatusDot
          tone={status}
          className={clsx(icon != null && styles['status-corner'])}
          ringClassName={styles['status-ring']}
        />
      )}
    </span>
  );
}

interface SubThreadRowProps {
  thread: Chat;
  isActive: boolean;
  isCurrent: boolean;
  isStreaming: boolean;
  isBlocked: boolean;
  isCompleted: boolean;
  isHovered: boolean;
  isDropdownOpen: boolean;
  onSelect: (chatId: string) => void;
  onDropdownClick: (e: MouseEvent<HTMLButtonElement>, chat: Chat) => void;
  onMouseEnter: (chatId: string) => void;
  onMouseLeave: () => void;
}

const SubThreadRow = memo(function SubThreadRow({
  thread,
  isActive,
  isCurrent,
  isStreaming,
  isBlocked,
  isCompleted,
  isHovered,
  isDropdownOpen,
  onSelect,
  onDropdownClick,
  onMouseEnter,
  onMouseLeave,
}: SubThreadRowProps) {
  const agentKind = useChatAgentKind(thread.id, thread.session_agent_kind, thread.last_model_id);
  const isRevealed = isHovered || isActive || isDropdownOpen;
  return (
    <NestedRow
      isActive={isActive}
      isCurrent={isCurrent}
      isRevealed={isRevealed}
      isEmphasized={isActive}
      leading={
        <SubThreadLeading
          icon={agentKind && <ProviderIcon agentKind={agentKind} />}
          status={chatStatusTone({
            blocked: isBlocked,
            streaming: isStreaming,
            completed: isCompleted,
          })}
          isRevealed={isRevealed}
        />
      }
      title={stripMarkdownTitle(thread.title)}
      tooltip={thread.title}
      timestamp={getRelativeTime(thread.updated_at)}
      dropdownLabel="Sub-thread options"
      onSelect={() => onSelect(thread.id)}
      onDropdownClick={(e) => onDropdownClick(e, thread)}
      onMouseEnter={() => onMouseEnter(thread.id)}
      onMouseLeave={onMouseLeave}
    />
  );
});

interface LinkedChannelRowProps {
  entry: MachineChannel;
  channelAgentKinds: (entry: MachineChannel) => AgentKind[];
  isActive: boolean;
  isCompleted: boolean;
  isHovered: boolean;
  isDropdownOpen: boolean;
  onSelect: (channelId: string) => void;
  onDropdownClick: (e: MouseEvent<HTMLButtonElement>, channel: Channel) => void;
  onMouseEnter: (channelId: string) => void;
  onMouseLeave: () => void;
}

const LinkedChannelRow = memo(function LinkedChannelRow({
  entry,
  channelAgentKinds,
  isActive,
  isCompleted,
  isHovered,
  isDropdownOpen,
  onSelect,
  onDropdownClick,
  onMouseEnter,
  onMouseLeave,
}: LinkedChannelRowProps) {
  const { channel } = entry;
  const { status, isUnread } = useChannelRowStatus(channel, isActive, isCompleted);
  return (
    <NestedRow
      isActive={isActive}
      isCurrent={isActive}
      isRevealed={isHovered || isActive || isDropdownOpen}
      isEmphasized={isActive || isUnread}
      leading={
        <ChannelRowLeading
          status={status}
          agentKinds={channelAgentKinds(entry)}
          memberCount={channel.members.length}
        />
      }
      title={channel.name}
      tooltip={`${channel.name} · ${channel.members.map((member) => member.display_name).join(', ')}`}
      timestamp={getRelativeTime(channel.updated_at)}
      dropdownLabel="Channel options"
      onSelect={() => onSelect(channel.id)}
      onDropdownClick={(e) => onDropdownClick(e, channel)}
      onMouseEnter={() => onMouseEnter(channel.id)}
      onMouseLeave={onMouseLeave}
    />
  );
});

interface SubThreadListProps {
  parentChatId: string;
  hasSubThreads: boolean;
  linkedChannels: MachineChannel[];
  channelAgentKinds: (entry: MachineChannel) => AgentKind[];
  selectedChannelId: string | null;
  channelActions: SidebarChannelActions;
  selectedChatId: string | null;
  splitChatIds: string[];
  dropdownChatId: string | null;
  onSelect: (chatId: string) => void;
  onDropdownClick: (e: MouseEvent<HTMLButtonElement>, chat: Chat) => void;
  streamingChatIdSet: Set<string>;
  blockedChatIdSet: Set<string>;
  completedChatIdSet: Set<string>;
}

export const SubThreadList = memo(function SubThreadList({
  parentChatId,
  hasSubThreads,
  linkedChannels,
  channelAgentKinds,
  selectedChannelId,
  channelActions,
  selectedChatId,
  splitChatIds,
  dropdownChatId,
  onSelect,
  onDropdownClick,
  streamingChatIdSet,
  blockedChatIdSet,
  completedChatIdSet,
}: SubThreadListProps) {
  const {
    data: subThreads,
    isError,
    refetch,
  } = useSubThreadsQuery(hasSubThreads ? parentChatId : undefined);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleMouseEnter = useCallback((id: string) => setHoveredId(id), []);
  const handleMouseLeave = useCallback(() => setHoveredId(null), []);

  const channelRows = linkedChannels.map((entry) => (
    <LinkedChannelRow
      key={entry.channel.id}
      entry={entry}
      channelAgentKinds={channelAgentKinds}
      isActive={entry.channel.id === selectedChannelId}
      isCompleted={channelActions.completedChannelIds.has(entry.channel.id)}
      isHovered={hoveredId === entry.channel.id}
      isDropdownOpen={channelActions.openMenuChannelId === entry.channel.id}
      onSelect={channelActions.handleChannelSelect}
      onDropdownClick={channelActions.handleChannelDropdownClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    />
  ));

  if (isError) {
    return (
      <div className={styles.branch}>
        <div className={styles['error-line']} />
        {channelRows}
        <Button variant="unstyled" type="button" onClick={() => refetch()} className={styles.retry}>
          Failed to load · Retry
        </Button>
      </div>
    );
  }

  if (!subThreads?.length && channelRows.length === 0) return null;

  const rows = (subThreads ?? []).map((thread) => ({
    thread,
    isActive: thread.id === selectedChatId || splitChatIds.includes(thread.id),
    isStreaming: streamingChatIdSet.has(thread.id),
    isBlocked: blockedChatIdSet.has(thread.id),
  }));
  // Active, running and blocked rows stay visible past the limit so they're never buried
  const collapsedRows = rows.filter(
    (row, index) => index < COLLAPSED_ROW_LIMIT || row.isActive || row.isStreaming || row.isBlocked,
  );
  const hiddenCount = rows.length - collapsedRows.length;
  const visibleRows = isExpanded ? rows : collapsedRows;

  return (
    <div className={styles.branch}>
      {channelRows}
      {visibleRows.map(({ thread, isActive, isStreaming, isBlocked }) => (
        <SubThreadRow
          key={thread.id}
          thread={thread}
          isActive={isActive}
          isCurrent={thread.id === selectedChatId}
          isStreaming={isStreaming}
          isBlocked={isBlocked}
          isCompleted={completedChatIdSet.has(thread.id)}
          isHovered={hoveredId === thread.id}
          isDropdownOpen={dropdownChatId === thread.id}
          onSelect={onSelect}
          onDropdownClick={onDropdownClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        />
      ))}
      {hiddenCount > 0 && (
        <Button
          variant="unstyled"
          type="button"
          onClick={() => setIsExpanded((expanded) => !expanded)}
          aria-expanded={isExpanded}
          className={styles['more-toggle']}
        >
          <span className={styles.connector} />
          {isExpanded ? 'Show less' : `Show ${hiddenCount} more`}
        </Button>
      )}
    </div>
  );
});
