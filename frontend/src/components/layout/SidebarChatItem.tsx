import { memo, useEffect, useRef } from 'react';
import { ChevronRight, Cloud, CornerDownRight, MoreHorizontal } from 'lucide-react';
import { AsciiSpinner } from '@/components/ui/AsciiSpinner';
import { ChatStatusDot, chatStatusTone, type ChatStatusTone } from '@/components/ui/ChatStatusDot';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { useChatAgentKind } from '@/hooks/useChatAgentKind';
import { cn } from '@/utils/cn';
import { stripMarkdownTitle } from '@/utils/format';
import { getRelativeTime } from '@/utils/date';
import type { Chat } from '@/types/chat.types';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';

// The `status` discriminant (derived per-row below) drives the leading glyph, its
// dot tone, and its tooltip word — precedence: needs-you > running > done > unread.
const STATUS_LABEL: Record<ChatStatusTone, string> = {
  blocked: 'Needs you',
  running: 'Running',
  completed: 'Done',
  unread: 'Unread',
};

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
  // Keep the active chat visible when navigation lands on an off-screen row
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isActive) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isActive]);
  // The open chat is being read — no unread signal for it
  const isUnread = !isActive && chat.unread;
  const agentKind = useChatAgentKind(chat.id, chat.session_agent_kind);
  // Persistent status on the leading icon (visible even on hover), mirroring the
  // sidebar precedence. Running shows the spinner; the other three show a dot.
  const status = chatStatusTone({
    blocked: isChatBlocked,
    streaming: isChatStreaming,
    completed: isChatCompleted,
    unread: isUnread,
  });
  const showSpinner = status === 'running';
  // The main slot shows the spinner for 'running', so it takes no dot there; every
  // other status renders its tone directly.
  const statusTone: ChatStatusTone | null = showSpinner ? null : status;
  const statusLabel = status ? STATUS_LABEL[status] : null;
  // Mirrors the leading-slot render below — the workspace line indents to stay flush with the title
  const hasLeadingSlot = hasSubThreads || agentKind != null || status != null;
  const statusSlot = hasLeadingSlot ? (
    // Running swaps to a spinner; blocked/done/unread show a colored dot on the
    // icon corner (or centered when there's no provider icon to anchor it).
    <span className="relative flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
      {showSpinner ? (
        <AsciiSpinner className="text-lg leading-none" />
      ) : agentKind ? (
        <ProviderIcon
          agentKind={agentKind}
          className="h-3.5 w-3.5 text-text-tertiary dark:text-text-dark-tertiary"
        />
      ) : null}
      {statusTone && (
        <ChatStatusDot
          tone={statusTone}
          // Corner-overlay only when there's a provider icon to anchor to;
          // otherwise the dot centers in the reserved box.
          className={cn(agentKind && 'absolute -right-0.5 -top-0.5')}
          ringClassName="ring-1 ring-surface-secondary dark:ring-surface-dark-secondary"
        />
      )}
    </span>
  ) : null;
  // On sub-threaded rows the caret takes the slot on hover/expand — overlay the
  // status dot on it (running shows as an amber dot, since there's no spinner here)
  // so the persistent status never vanishes while sub-threads are open.
  const showCaret = hasSubThreads && (isHovered || isSubThreadsExpanded);
  const leadingIcon = showCaret ? (
    <Button
      onClick={() => onToggleSubThreads(chat.id)}
      aria-expanded={isSubThreadsExpanded}
      aria-label={`${isSubThreadsExpanded ? 'Collapse' : 'Expand'} ${chat.sub_thread_count} sub-threads`}
      variant="unstyled"
      // -m-1/p-1 keeps a large thumb target without shifting the row
      className="-m-1 flex-shrink-0 p-1 text-text-tertiary hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
    >
      <span className="relative flex h-3.5 w-3.5 items-center justify-center">
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 transition-transform duration-200',
            isSubThreadsExpanded && 'rotate-90',
          )}
        />
        {status && (
          <ChatStatusDot
            tone={status}
            className="absolute -right-0.5 -top-0.5"
            ringClassName="ring-1 ring-surface-secondary dark:ring-surface-dark-secondary"
          />
        )}
      </span>
    </Button>
  ) : statusLabel ? (
    // Wordless dot/spinner carries status; the word lives in a tooltip
    <FloatingTooltip content={statusLabel} className="flex flex-shrink-0 items-center">
      {statusSlot}
    </FloatingTooltip>
  ) : (
    statusSlot
  );
  return (
    <div
      ref={rowRef}
      className={cn(
        'group relative -mx-2 flex items-center gap-2 rounded-lg px-2 py-[7px] transition-colors duration-200',
        isActive
          ? 'bg-surface-hover/50 text-text-primary dark:bg-surface-dark-hover/50 dark:text-text-dark-primary'
          : 'text-text-secondary hover:bg-surface-hover/50 hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover/50 dark:hover:text-text-dark-secondary',
      )}
      onMouseEnter={() => onMouseEnter(chat.id)}
      onMouseLeave={onMouseLeave}
    >
      {/* Right padding reserves room for the timestamp/dropdown so long titles
          truncate before reaching them. */}
      <div className="flex min-w-0 flex-1 flex-col pr-10">
        <div className="flex min-w-0 items-center gap-1.5">
          {/* One leading slot keeps all row titles flush: caret on hover/expand,
              otherwise the provider icon + a persistent status dot (or spinner). */}
          {leadingIcon}
          {/* Tooltip wraps only the title, not the icon — so the icon's own status
              tooltip fires on its own hover instead of stacking with this one. */}
          <FloatingTooltip
            content={onOpenInSplit ? `${chat.title} (Shift-click to open in split)` : chat.title}
            className="flex min-w-0 flex-1"
          >
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
          </FloatingTooltip>
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
      </div>

      {/* Right slot shows the timestamp — status now lives on the leading
          dot/spinner. Hides on hover to reveal the dropdown. */}
      <span
        className={cn(
          'absolute right-2 flex items-center text-[10px] tabular-nums text-text-quaternary transition-opacity duration-200 dark:text-text-dark-quaternary',
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
