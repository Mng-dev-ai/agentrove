import { memo } from 'react';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { cn } from '@/utils/cn';
import { stripMarkdownTitle } from '@/utils/format';
import { getRelativeTime } from '@/utils/date';
import type { Chat } from '@/types/chat.types';

interface SidebarChatItemProps {
  chat: Chat;
  isSelected: boolean;
  isActive?: boolean;
  isHovered: boolean;
  isDropdownOpen: boolean;
  isChatStreaming: boolean;
  onSelect: (chatId: string) => void;
  onOpenInSplit?: (chatId: string) => void;
  onDropdownClick: (e: React.MouseEvent<HTMLButtonElement>, chat: Chat) => void;
  onMouseEnter: (chatId: string) => void;
  onMouseLeave: () => void;
  onToggleSubThreads?: (chatId: string) => void;
  isSubThreadsExpanded?: boolean;
}

export const SidebarChatItem = memo(function SidebarChatItem({
  chat,
  isSelected,
  isActive = isSelected,
  isHovered,
  isDropdownOpen,
  isChatStreaming,
  onSelect,
  onOpenInSplit,
  onDropdownClick,
  onMouseEnter,
  onMouseLeave,
  onToggleSubThreads,
  isSubThreadsExpanded,
}: SidebarChatItemProps) {
  // onToggleSubThreads is only set when sub_thread_count > 0
  const hasSubThreads = onToggleSubThreads != null;
  return (
    <div
      className={cn(
        'group relative -mx-2 flex items-center gap-2 rounded-lg px-2 py-[7px] transition-colors duration-200',
        isActive
          ? 'bg-surface-hover/50 text-text-primary dark:bg-surface-dark-hover/50 dark:text-text-dark-primary'
          : 'text-text-secondary hover:bg-surface-hover/50 hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover/50 dark:hover:text-text-dark-secondary',
      )}
      onMouseEnter={() => onMouseEnter(chat.id)}
      onMouseLeave={onMouseLeave}
    >
      {hasSubThreads ? (
        <Button
          onClick={() => onToggleSubThreads(chat.id)}
          aria-expanded={isSubThreadsExpanded}
          aria-label={`${isSubThreadsExpanded ? 'Collapse' : 'Expand'} ${chat.sub_thread_count} sub-threads`}
          variant="unstyled"
          // Leading disclosure caret toggles sub-threads; -m-1/p-1 keeps a large thumb target without shifting the row
          className="-m-1 flex-shrink-0 p-1 text-text-tertiary hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 transition-transform duration-200',
              isSubThreadsExpanded && 'rotate-90',
            )}
          />
        </Button>
      ) : (
        // Spacer aligns childless-chat titles with rows that show a caret
        <div className="h-3 w-3 flex-shrink-0" />
      )}

      <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-10">
        {isChatStreaming && (
          <div className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-warning-500" />
        )}
        <Button
          onClick={(e) => {
            if (e.shiftKey && onOpenInSplit && !isActive) {
              e.preventDefault();
              onOpenInSplit(chat.id);
              return;
            }
            onSelect(chat.id);
          }}
          aria-current={isSelected ? 'page' : undefined}
          variant="unstyled"
          title={onOpenInSplit ? `${chat.title} (Shift-click to open in split)` : chat.title}
          // flex-1 keeps the whole row width as the open-chat hit target, not just the text
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px]"
        >
          {chat.session_agent_kind && (
            <ProviderIcon
              agentKind={chat.session_agent_kind}
              className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary dark:text-text-dark-tertiary"
            />
          )}
          <span className={cn('min-w-0 truncate', isActive && 'font-medium')}>
            {stripMarkdownTitle(chat.title)}
          </span>
          {/* Quiet sub-thread count — the toggle itself lives in the leading caret */}
          {hasSubThreads && !isSubThreadsExpanded && (
            <span className="flex-shrink-0 text-2xs tabular-nums text-text-quaternary dark:text-text-dark-quaternary">
              {chat.sub_thread_count}
            </span>
          )}
        </Button>
      </div>

      <span
        className={cn(
          'absolute right-2 text-[10px] tabular-nums text-text-quaternary dark:text-text-dark-quaternary',
          'transition-opacity duration-200',
          isHovered || isActive || isDropdownOpen ? 'opacity-0' : 'opacity-100',
        )}
      >
        {getRelativeTime(chat.updated_at)}
      </span>

      <Button
        onClick={(e) => onDropdownClick(e, chat)}
        onMouseDown={(e) => e.stopPropagation()}
        variant="unstyled"
        className={cn(
          'absolute right-2 flex-shrink-0 rounded-md p-0.5 transition-all duration-200',
          'text-text-quaternary dark:text-text-dark-quaternary',
          'hover:text-text-primary dark:hover:text-text-dark-primary',
          isHovered || isActive || isDropdownOpen
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100',
        )}
        aria-label="Chat options"
      >
        <MoreHorizontal className="h-3 w-3" />
      </Button>
    </div>
  );
});
