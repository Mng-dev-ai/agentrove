import { memo } from 'react';
import { Check, ChevronRight, Cloud, CornerDownRight, Loader2, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { useChatAgentKind } from '@/hooks/useChatAgentKind';
import { cn } from '@/utils/cn';
import { stripMarkdownTitle } from '@/utils/format';
import { getRelativeTime } from '@/utils/date';
import type { Chat } from '@/types/chat.types';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';

interface SidebarChatItemProps {
  chat: Chat;
  isSelected: boolean;
  isActive?: boolean;
  isHovered: boolean;
  isDropdownOpen: boolean;
  isChatStreaming: boolean;
  isChatBlocked: boolean;
  isChatCompleted: boolean;
  workspaceBadge?: WorkspaceBadge;
  onSelect: (chatId: string) => void;
  onOpenInSplit?: (chatId: string) => void;
  onDropdownClick: (e: React.MouseEvent<HTMLButtonElement>, chat: Chat) => void;
  onWorkspaceBadgeClick: (e: React.MouseEvent<HTMLButtonElement>, workspaceId: string) => void;
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
  isChatBlocked,
  isChatCompleted,
  workspaceBadge,
  onSelect,
  onOpenInSplit,
  onDropdownClick,
  onWorkspaceBadgeClick,
  onMouseEnter,
  onMouseLeave,
  onToggleSubThreads,
  isSubThreadsExpanded,
}: SidebarChatItemProps) {
  // onToggleSubThreads is only set when sub_thread_count > 0
  const hasSubThreads = onToggleSubThreads != null;
  // The open chat is being read — no unread signal for it
  const isUnread = !isActive && chat.unread;
  const hasStatusBadge = isChatBlocked || isChatStreaming || isChatCompleted || isUnread;
  const agentKind = useChatAgentKind(chat.id, chat.session_agent_kind);
  // Mirrors the leading-slot render below — the workspace line indents to stay flush with the title
  const hasLeadingSlot = hasSubThreads || agentKind != null;
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
      {/* Wider right padding when a status badge shows reserves room for it so
          long titles truncate before reaching it. */}
      <FloatingTooltip
        content={onOpenInSplit ? `${chat.title} (Shift-click to open in split)` : chat.title}
        className={cn('flex min-w-0 flex-1 flex-col', hasStatusBadge ? 'pr-[76px]' : 'pr-10')}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {/* One leading slot keeps all row titles flush: the disclosure caret
              swaps in for the provider icon on hover/expand. */}
          {hasSubThreads && (isHovered || isSubThreadsExpanded) ? (
            <Button
              onClick={() => onToggleSubThreads(chat.id)}
              aria-expanded={isSubThreadsExpanded}
              aria-label={`${isSubThreadsExpanded ? 'Collapse' : 'Expand'} ${chat.sub_thread_count} sub-threads`}
              variant="unstyled"
              // -m-1/p-1 keeps a large thumb target without shifting the row
              className="-m-1 flex-shrink-0 p-1 text-text-tertiary hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
            >
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 transition-transform duration-200',
                  isSubThreadsExpanded && 'rotate-90',
                )}
              />
            </Button>
          ) : agentKind ? (
            <ProviderIcon
              agentKind={agentKind}
              className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary dark:text-text-dark-tertiary"
            />
          ) : hasSubThreads ? (
            // Iconless chats still reserve the slot so the title doesn't shift when the caret swaps in
            <div className="h-3.5 w-3.5 flex-shrink-0" />
          ) : null}
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
            // flex-1 keeps the whole row width as the open-chat hit target, not just the text
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[13px]"
          >
            <span className={cn('min-w-0 truncate', (isActive || isUnread) && 'font-medium')}>
              {stripMarkdownTitle(chat.title)}
            </span>
            {/* Resting hint that sub-threads exist; the caret conveys it on hover/expand */}
            {hasSubThreads && !isHovered && !isSubThreadsExpanded && (
              <CornerDownRight className="h-3 w-3 flex-shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
            )}
          </Button>
        </div>
        {/* Clicking the badge opens the workspace context menu (new thread, rename,
            delete) — the flat list has no group headers to hang those actions on. */}
        {workspaceBadge && (
          <Button
            variant="unstyled"
            type="button"
            data-ws-dropdown-trigger
            onClick={(e) => onWorkspaceBadgeClick(e, chat.workspace_id)}
            aria-label={`${workspaceBadge.name} workspace options`}
            // pl-5 (icon 14px + gap 6px) indents the name under the title, not the icon
            className={cn(
              'flex max-w-full items-center gap-1 self-start text-[10px] font-medium text-text-quaternary transition-colors duration-200 hover:text-text-primary dark:text-text-dark-quaternary dark:hover:text-text-dark-primary',
              hasLeadingSlot && 'pl-5',
            )}
          >
            {workspaceBadge.isCloud && <Cloud className="h-2.5 w-2.5 flex-shrink-0" />}
            <span className="truncate">{workspaceBadge.name}</span>
          </Button>
        )}
      </FloatingTooltip>

      {/* One status badge by precedence: a pending request blocks the agent
          (loudest, only pulsing element), then the live run, then done-since-
          last-viewed, then unseen activity. Idle rows fall back to the timestamp. */}
      <span
        className={cn(
          'absolute right-2 flex items-center text-[10px] transition-opacity duration-200',
          isHovered || isActive || isDropdownOpen ? 'opacity-0' : 'opacity-100',
        )}
      >
        {isChatBlocked ? (
          <span className="animate-pulse rounded-md bg-warning-100 px-1.5 py-0.5 font-medium text-warning-600 dark:bg-warning-500/10 dark:text-warning-400">
            Needs you
          </span>
        ) : isChatStreaming ? (
          // Neutral fill keeps amber exclusive to "action required" — the spinner carries the signal
          <span className="flex items-center gap-1 rounded-md bg-surface-tertiary px-1.5 py-0.5 font-medium text-text-tertiary dark:bg-surface-dark-tertiary/50 dark:text-text-dark-tertiary">
            <Loader2 className="h-2.5 w-2.5 animate-spin text-warning-500" />
            Running
          </span>
        ) : isChatCompleted ? (
          <span className="flex items-center gap-1 rounded-md bg-success-100 px-1.5 py-0.5 font-medium text-success-600 dark:bg-success-500/10 dark:text-success-400">
            <Check className="h-2.5 w-2.5" />
            Done
          </span>
        ) : isUnread ? (
          <span className="rounded-md bg-surface-tertiary px-1.5 py-0.5 font-medium text-text-primary dark:bg-surface-dark-tertiary/50 dark:text-text-dark-primary">
            Unread
          </span>
        ) : (
          <span className="tabular-nums text-text-quaternary dark:text-text-dark-quaternary">
            {getRelativeTime(chat.updated_at)}
          </span>
        )}
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
