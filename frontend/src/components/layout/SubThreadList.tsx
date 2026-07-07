import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useSubThreadsQuery } from '@/hooks/queries/useChatQueries';
import { useChatAgentKind } from '@/hooks/useChatAgentKind';
import { AsciiSpinner } from '@/components/ui/AsciiSpinner';
import { ChatStatusDot, chatStatusTone, type ChatStatusTone } from '@/components/ui/ChatStatusDot';
import { Button } from '@/components/ui/primitives/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { cn } from '@/utils/cn';
import { stripMarkdownTitle } from '@/utils/format';
import { getRelativeTime } from '@/utils/date';
import type { Chat } from '@/types/chat.types';

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
      className={cn(
        'group relative flex items-center rounded-lg transition-colors duration-200',
        isActive
          ? 'bg-surface-hover/50 dark:bg-surface-dark-hover/50'
          : 'hover:bg-surface-hover/50 dark:hover:bg-surface-dark-hover/50',
      )}
      onMouseEnter={() => onMouseEnter(thread.id)}
      onMouseLeave={onMouseLeave}
    >
      <div className="absolute -left-[22px] top-1/2 h-px w-[18px] bg-border-secondary dark:bg-border-dark-secondary" />

      <FloatingTooltip content={thread.title} className="flex min-w-0 flex-1">
        <Button
          variant="unstyled"
          type="button"
          onClick={() => onSelect(thread.id)}
          className={cn(
            'flex w-full min-w-0 items-center gap-2 px-2 py-1.5 pr-10 transition-colors duration-200',
            isActive
              ? 'text-text-primary dark:text-text-dark-primary'
              : 'text-text-tertiary hover:text-text-secondary dark:text-text-dark-tertiary dark:hover:text-text-dark-secondary',
          )}
        >
          {hasLeadingSlot && (
            <span className="relative flex h-3 w-3 flex-shrink-0 items-center justify-center">
              {showSpinner ? (
                <AsciiSpinner className="text-base leading-none" />
              ) : agentKind ? (
                <ProviderIcon
                  agentKind={agentKind}
                  className="h-3 w-3 text-text-tertiary dark:text-text-dark-tertiary"
                />
              ) : null}
              {statusTone && (
                <ChatStatusDot
                  tone={statusTone}
                  className={cn(agentKind && 'absolute -right-0.5 -top-0.5')}
                  ringClassName="ring-1 ring-surface-secondary dark:ring-surface-dark-secondary"
                />
              )}
            </span>
          )}
          <span className={cn('truncate text-xs', isActive && 'font-medium')}>
            {stripMarkdownTitle(thread.title)}
          </span>
        </Button>
      </FloatingTooltip>

      {/* Status now lives on the leading icon; the right slot shows the timestamp
          and hides on hover to reveal the dropdown. */}
      <span
        className={cn(
          'absolute right-2 flex items-center text-[10px] tabular-nums text-text-quaternary transition-opacity duration-200 dark:text-text-dark-quaternary',
          isHovered || isActive ? 'opacity-0' : 'opacity-100',
        )}
      >
        {getRelativeTime(thread.updated_at)}
      </span>

      <Button
        onClick={(e) => onDropdownClick(e, thread)}
        onMouseDown={(e) => e.stopPropagation()}
        variant="unstyled"
        className={cn(
          'absolute right-2 flex-shrink-0 rounded-md p-0.5 transition-all duration-200',
          'text-text-quaternary dark:text-text-dark-quaternary',
          'hover:text-text-primary dark:hover:text-text-dark-primary',
          isHovered || isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
        aria-label="Sub-thread options"
      >
        <MoreHorizontal className="h-3 w-3" />
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
      <div className="relative ml-[11px] mt-0.5 pl-[22px]">
        <div className="absolute bottom-2 left-0 top-0 w-px bg-border-secondary dark:bg-border-dark-secondary" />
        <Button
          variant="unstyled"
          type="button"
          onClick={() => refetch()}
          className="text-2xs text-text-quaternary transition-colors duration-200 hover:text-text-tertiary dark:text-text-dark-quaternary dark:hover:text-text-dark-tertiary"
        >
          Failed to load · Retry
        </Button>
      </div>
    );
  }

  if (!subThreads || subThreads.length === 0) return null;

  return (
    <div className="relative ml-[11px] mt-0.5 pl-[22px]">
      <div className="absolute bottom-[14px] left-0 top-0 w-px bg-border-secondary dark:bg-border-dark-secondary" />

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
