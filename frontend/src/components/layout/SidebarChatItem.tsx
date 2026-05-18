import { memo } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
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
        'group relative -mx-2 flex items-center gap-[11px] rounded-lg px-2 py-[7px] transition-colors duration-200',
        isActive
          ? 'bg-surface-hover/50 text-text-primary dark:bg-surface-dark-hover/50 dark:text-text-dark-primary'
          : 'text-text-secondary hover:bg-surface-hover/50 hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover/50 dark:hover:text-text-dark-secondary',
      )}
      onMouseEnter={() => onMouseEnter(chat.id)}
      onMouseLeave={onMouseLeave}
    >
      {isActive && !isChatStreaming && (
        <div className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-text-primary dark:bg-text-dark-primary" />
      )}

      {isChatStreaming ? (
        <div className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-warning-500" />
      ) : (
        <div className="h-1.5 w-1.5 flex-shrink-0" />
      )}

      <Button
        onClick={(e) => {
          if (e.shiftKey && onOpenInSplit && !isActive) {
            e.preventDefault();
            onOpenInSplit(chat.id);
            return;
          }
          onSelect(chat.id);
          if (hasSubThreads) {
            onToggleSubThreads(chat.id);
          }
        }}
        aria-current={isSelected ? 'page' : undefined}
        aria-expanded={hasSubThreads ? isSubThreadsExpanded : undefined}
        variant="unstyled"
        title={onOpenInSplit ? `${chat.title} (Shift-click to open in split)` : chat.title}
        className="min-w-0 flex-1 pr-10 text-left text-[13px]"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn('min-w-0 truncate', isActive && 'font-medium')}>
            {stripMarkdownTitle(chat.title)}
          </span>
          {/* Sub-thread count pill — only shown when collapsed so the user knows there are expandable threads */}
          {chat.sub_thread_count > 0 && !isSubThreadsExpanded && (
            <span className="flex-shrink-0 rounded-full bg-surface-tertiary px-1.5 py-0.5 text-2xs text-text-tertiary dark:bg-surface-dark-tertiary dark:text-text-dark-tertiary">
              {chat.sub_thread_count}
            </span>
          )}
        </span>
      </Button>

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
