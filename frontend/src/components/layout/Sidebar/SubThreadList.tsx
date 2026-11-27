import { memo, useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Hash, MoreHorizontal } from 'lucide-react';
import { useSubThreadsQuery } from '@/hooks/queries/useChatQueries';
import { useChatAgentKind } from '@/hooks/useChatAgentKind';
import { AsciiSpinner } from '@/components/ui/AsciiSpinner/AsciiSpinner';
import { ChatStatusDot } from '@/components/ui/ChatStatusDot/ChatStatusDot';
import { useChannelActivity } from '@/store/channelStore';
import { chatStatusTone, CHAT_STATUS_LABEL, type ChatStatusTone } from '@/utils/message';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import clsx from 'clsx';
import { stripMarkdownTitle } from '@/utils/format';
import { getRelativeTime } from '@/utils/date';
import { stateClasses } from '@/config/stateClasses';
import type { Channel } from '@/types/channel.types';
import type { Chat } from '@/types/chat.types';
import type { MachineChannel } from './sidebarGrouping';
import styles from './SubThreadList.module.scss';

const COLLAPSED_ROW_LIMIT = 5;

interface SubThreadRowProps {
  thread: Chat;
  isActive: boolean;
  isStreaming: boolean;
  isBlocked: boolean;
  isCompleted: boolean;
  isHovered: boolean;
  onSelect: (chatId: string) => void;
  onDropdownClick: (e: React.MouseEvent<HTMLButtonElement>, chat: Chat) => void;
  onMouseEnter: (chatId: string) => void;
  onMouseLeave: () => void;
}

const SubThreadRow = memo(function SubThreadRow({
  thread,
  isActive,
  isStreaming,
  isBlocked,
  isCompleted,
  isHovered,
  onSelect,
  onDropdownClick,
  onMouseEnter,
  onMouseLeave,
}: SubThreadRowProps) {
  const agentKind = useChatAgentKind(thread.id, thread.session_agent_kind, thread.last_model_id);
  // Same status language as top-level rows: red dot = needs you, braille spinner =
  // running, green dot = done. Persistent on the leading icon (visible on hover).
  const status = chatStatusTone({
    blocked: isBlocked,
    streaming: isStreaming,
    completed: isCompleted,
  });
  const showSpinner = status === 'running';
  const statusTone: ChatStatusTone | null = showSpinner ? null : status;
  const hasLeadingSlot = agentKind != null || status != null;
  // Keep the active sub-thread visible when navigation lands on an off-screen row
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isActive) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isActive]);
  return (
    <div
      ref={rowRef}
      className={clsx(styles['subthread-row'], isActive && stateClasses.ACTIVE)}
      onMouseEnter={() => onMouseEnter(thread.id)}
      onMouseLeave={onMouseLeave}
    >
      <div className={styles.connector} />

      <FloatingTooltip content={thread.title} className={styles['thread-tooltip']}>
        <Button
          variant="unstyled"
          type="button"
          onClick={() => onSelect(thread.id)}
          className={styles['subthread-select']}
        >
          {hasLeadingSlot && (
            <span className={styles['leading-slot']}>
              {showSpinner ? (
                <AsciiSpinner className={styles['subthread-spinner']} />
              ) : agentKind ? (
                <ProviderIcon
                  agentKind={agentKind}
                  className={clsx(
                    styles['leading-icon'],
                    !isHovered && !isActive && styles['leading-icon--muted'],
                  )}
                />
              ) : null}
              {statusTone && (
                <ChatStatusDot
                  tone={statusTone}
                  className={clsx(agentKind && styles['status-corner'])}
                  ringClassName={styles['status-ring']}
                />
              )}
            </span>
          )}
          <span className={styles.title}>{stripMarkdownTitle(thread.title)}</span>
        </Button>
      </FloatingTooltip>

      {/* Status now lives on the leading icon; the right slot shows the timestamp
          and hides on hover to reveal the dropdown. */}
      <span
        className={clsx(styles.timestamp, (isHovered || isActive) && styles['timestamp--hidden'])}
      >
        {getRelativeTime(thread.updated_at)}
      </span>

      <Button
        onClick={(e) => onDropdownClick(e, thread)}
        onMouseDown={(e) => e.stopPropagation()}
        variant="unstyled"
        className={clsx(
          styles['dropdown-btn'],
          (isHovered || isActive) && styles['dropdown-btn--visible'],
        )}
        aria-label="Sub-thread options"
      >
        <MoreHorizontal className={styles['dropdown-icon']} />
      </Button>
    </div>
  );
});

interface LinkedChannelRowProps {
  channel: Channel;
  isActive: boolean;
  isCompleted: boolean;
  isHovered: boolean;
  isDropdownOpen: boolean;
  onSelect: (channelId: string) => void;
  onDropdownClick: (e: MouseEvent<HTMLButtonElement>, channel: Channel) => void;
  onMouseEnter: (channelId: string) => void;
  onMouseLeave: () => void;
}

// Sub-thread geometry with the channel row's icon, unread mark and member activity
const LinkedChannelRow = memo(function LinkedChannelRow({
  channel,
  isActive,
  isCompleted,
  isHovered,
  isDropdownOpen,
  onSelect,
  onDropdownClick,
  onMouseEnter,
  onMouseLeave,
}: LinkedChannelRowProps) {
  const activity = useChannelActivity(channel);
  const isUnread = !isActive && !!channel.unread;
  const status = chatStatusTone({
    blocked: activity.waiting_member_ids.length > 0,
    streaming: activity.member_ids.length > 0,
    completed: isCompleted,
    unread: isUnread,
  });
  const statusLabel = status ? CHAT_STATUS_LABEL[status] : undefined;
  const isRevealed = isHovered || isActive || isDropdownOpen;
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isActive) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isActive]);
  return (
    <div
      ref={rowRef}
      className={clsx(styles['subthread-row'], isActive && stateClasses.ACTIVE)}
      onMouseEnter={() => onMouseEnter(channel.id)}
      onMouseLeave={onMouseLeave}
    >
      <div className={styles.connector} />

      <FloatingTooltip content={channel.name} className={styles['thread-tooltip']}>
        <Button
          variant="unstyled"
          type="button"
          onClick={() => onSelect(channel.id)}
          aria-current={isActive ? 'page' : undefined}
          className={styles['subthread-select']}
        >
          <span
            className={styles['leading-slot']}
            role={statusLabel ? 'img' : undefined}
            aria-label={statusLabel}
          >
            {status === 'running' ? (
              <AsciiSpinner className={styles['subthread-spinner']} />
            ) : (
              <Hash
                className={clsx(
                  styles['leading-icon'],
                  !isRevealed && styles['leading-icon--muted'],
                )}
              />
            )}
            {status && status !== 'running' && (
              <ChatStatusDot
                tone={status}
                className={styles['status-corner']}
                ringClassName={styles['status-ring']}
              />
            )}
          </span>
          <span className={clsx(styles.title, isUnread && styles['title--emphasis'])}>
            {channel.name}
          </span>
        </Button>
      </FloatingTooltip>

      <span className={clsx(styles.timestamp, isRevealed && styles['timestamp--hidden'])}>
        {getRelativeTime(channel.updated_at)}
      </span>

      <Button
        onClick={(e) => onDropdownClick(e, channel)}
        onMouseDown={(e) => e.stopPropagation()}
        variant="unstyled"
        className={clsx(styles['dropdown-btn'], isRevealed && styles['dropdown-btn--visible'])}
        aria-label="Channel options"
      >
        <MoreHorizontal className={styles['dropdown-icon']} />
      </Button>
    </div>
  );
});

interface SubThreadListProps {
  parentChatId: string;
  hasSubThreads: boolean;
  linkedChannels: MachineChannel[];
  selectedChannelId: string | null;
  openMenuChannelId: string | null;
  completedChannelIds: ReadonlySet<string>;
  onChannelSelect: (channelId: string) => void;
  onChannelDropdownClick: (e: MouseEvent<HTMLButtonElement>, channel: Channel) => void;
  selectedChatId: string | null;
  splitChatIds: string[];
  onSelect: (chatId: string) => void;
  onDropdownClick: (e: React.MouseEvent<HTMLButtonElement>, chat: Chat) => void;
  streamingChatIdSet: Set<string>;
  blockedChatIdSet: Set<string>;
  completedChatIdSet: Set<string>;
}

export const SubThreadList = memo(function SubThreadList({
  parentChatId,
  selectedChatId,
  splitChatIds,
  onSelect,
  onDropdownClick,
  streamingChatIdSet,
  blockedChatIdSet,
  completedChatIdSet,
  hasSubThreads,
  linkedChannels,
  selectedChannelId,
  openMenuChannelId,
  completedChannelIds,
  onChannelSelect,
  onChannelDropdownClick,
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

  const channelRows = linkedChannels.map(({ channel }) => (
    <LinkedChannelRow
      key={channel.id}
      channel={channel}
      isActive={channel.id === selectedChannelId}
      isCompleted={completedChannelIds.has(channel.id)}
      isHovered={hoveredId === channel.id}
      isDropdownOpen={openMenuChannelId === channel.id}
      onSelect={onChannelSelect}
      onDropdownClick={onChannelDropdownClick}
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
          isStreaming={isStreaming}
          isBlocked={isBlocked}
          isCompleted={completedChatIdSet.has(thread.id)}
          isHovered={hoveredId === thread.id}
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
