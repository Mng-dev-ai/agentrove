import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useSubThreadsQuery } from '@/hooks/queries/useChatQueries';
import { useChatAgentKind } from '@/hooks/useChatAgentKind';
import { AsciiSpinner } from '@/components/ui/AsciiSpinner/AsciiSpinner';
import {
  ChatStatusDot,
  chatStatusTone,
  type ChatStatusTone,
} from '@/components/ui/ChatStatusDot/ChatStatusDot';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import clsx from 'clsx';
import { stripMarkdownTitle } from '@/utils/format';
import { getRelativeTime } from '@/utils/date';
import { stateClasses } from '@/config/stateClasses';
import type { Chat } from '@/types/chat.types';
import styles from './SubThreadList.module.scss';

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
  const agentKind = useChatAgentKind(thread.id, thread.session_agent_kind);
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
                <ProviderIcon agentKind={agentKind} className={styles['provider-icon']} />
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

interface SubThreadListProps {
  parentChatId: string;
  selectedChatId: string | null;
  secondaryChatId?: string | null;
  onSelect: (chatId: string) => void;
  onDropdownClick: (e: React.MouseEvent<HTMLButtonElement>, chat: Chat) => void;
  streamingChatIdSet: Set<string>;
  blockedChatIdSet: Set<string>;
  completedChatIdSet: Set<string>;
}

export const SubThreadList = memo(function SubThreadList({
  parentChatId,
  selectedChatId,
  secondaryChatId,
  onSelect,
  onDropdownClick,
  streamingChatIdSet,
  blockedChatIdSet,
  completedChatIdSet,
}: SubThreadListProps) {
  const { data: subThreads, isLoading, isError, refetch } = useSubThreadsQuery(parentChatId);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleMouseEnter = useCallback((id: string) => setHoveredId(id), []);
  const handleMouseLeave = useCallback(() => setHoveredId(null), []);

  if (isLoading || (!subThreads && !isError)) return null;

  if (isError) {
    return (
      <div className={styles.branch}>
        <div className={styles['error-line']} />
        <Button variant="unstyled" type="button" onClick={() => refetch()} className={styles.retry}>
          Failed to load · Retry
        </Button>
      </div>
    );
  }

  if (!subThreads || subThreads.length === 0) return null;

  return (
    <div className={styles.branch}>
      <div className={styles['list-line']} />

      {subThreads.map((thread) => (
        <SubThreadRow
          key={thread.id}
          thread={thread}
          isActive={thread.id === selectedChatId || thread.id === secondaryChatId}
          isStreaming={streamingChatIdSet.has(thread.id)}
          isBlocked={blockedChatIdSet.has(thread.id)}
          isCompleted={completedChatIdSet.has(thread.id)}
          isHovered={hoveredId === thread.id}
          onSelect={onSelect}
          onDropdownClick={onDropdownClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        />
      ))}
    </div>
  );
});
