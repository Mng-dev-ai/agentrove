import { memo, useState, useCallback } from 'react';
import { AlertCircle, Check, Loader2, MoreHorizontal } from 'lucide-react';
import { useSubThreadsQuery } from '@/hooks/queries/useChatQueries';
import { Button } from '@/components/ui/primitives/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { cn } from '@/utils/cn';
import { stripMarkdownTitle } from '@/utils/format';
import { getRelativeTime } from '@/utils/date';
import type { Chat } from '@/types/chat.types';

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

      {subThreads.map((thread) => {
        const isSelected = thread.id === selectedChatId;
        const isActive = isSelected || thread.id === secondaryChatId;
        const isStreaming = streamingChatIdSet.has(thread.id);
        const isBlocked = blockedChatIdSet.has(thread.id);
        const isCompleted = completedChatIdSet.has(thread.id);
        const isHovered = hoveredId === thread.id;

        return (
          <div
            key={thread.id}
            className={cn(
              'group relative flex items-center rounded-lg transition-colors duration-200',
              isActive
                ? 'bg-surface-hover/50 dark:bg-surface-dark-hover/50'
                : 'hover:bg-surface-hover/50 dark:hover:bg-surface-dark-hover/50',
            )}
            onMouseEnter={() => handleMouseEnter(thread.id)}
            onMouseLeave={handleMouseLeave}
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
                {thread.session_agent_kind && (
                  <ProviderIcon
                    agentKind={thread.session_agent_kind}
                    className="h-3 w-3 flex-shrink-0 text-text-tertiary dark:text-text-dark-tertiary"
                  />
                )}
                <span className={cn('truncate text-xs', isActive && 'font-medium')}>
                  {stripMarkdownTitle(thread.title)}
                </span>
              </Button>
            </FloatingTooltip>

            {/* Icon-only status — sub-thread rows are too tight for the labeled
                badges top-level chats use. Same precedence: blocked > running > done. */}
            <span
              className={cn(
                'absolute right-2 flex items-center transition-opacity duration-200',
                isHovered || isActive ? 'opacity-0' : 'opacity-100',
              )}
            >
              {isBlocked ? (
                <AlertCircle className="h-3 w-3 animate-pulse text-warning-500" />
              ) : isStreaming ? (
                <Loader2 className="h-3 w-3 animate-spin text-warning-500" />
              ) : isCompleted ? (
                <Check className="h-3 w-3 text-success-600 dark:text-success-400" />
              ) : (
                <span className="text-[10px] tabular-nums text-text-quaternary dark:text-text-dark-quaternary">
                  {getRelativeTime(thread.updated_at)}
                </span>
              )}
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
      })}
    </div>
  );
});
