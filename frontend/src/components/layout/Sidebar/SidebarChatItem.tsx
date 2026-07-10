import { memo, useEffect, useRef } from 'react';
import { ChevronRight, Cloud, CornerDownRight, MoreHorizontal } from 'lucide-react';
import { AsciiSpinner } from '@/components/ui/AsciiSpinner/AsciiSpinner';
import {
  ChatStatusDot,
  chatStatusTone,
  type ChatStatusTone,
} from '@/components/ui/ChatStatusDot/ChatStatusDot';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { ProviderIcon } from '@/components/ui/icons/ProviderIcon';
import { useChatAgentKind } from '@/hooks/useChatAgentKind';
import clsx from 'clsx';
import { stripMarkdownTitle } from '@/utils/format';
import { getRelativeTime } from '@/utils/date';
import { stateClasses } from '@/config/stateClasses';
import type { Chat } from '@/types/chat.types';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import styles from './SidebarChatItem.module.scss';

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
    <span className={styles['status-slot']}>
      {showSpinner ? (
        <AsciiSpinner className={styles['item-spinner']} />
      ) : agentKind ? (
        <ProviderIcon agentKind={agentKind} className={styles['provider-icon']} />
      ) : null}
      {statusTone && (
        <ChatStatusDot
          tone={statusTone}
          // Corner-overlay only when there's a provider icon to anchor to;
          // otherwise the dot centers in the reserved box.
          className={clsx(agentKind && styles['status-corner'])}
          ringClassName={styles['status-ring']}
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
      className={styles['caret-btn']}
    >
      <span className={styles['caret-slot']}>
        <ChevronRight
          className={clsx(styles.chevron, isSubThreadsExpanded && styles['chevron--expanded'])}
        />
        {status && (
          <ChatStatusDot
            tone={status}
            className={styles['status-corner']}
            ringClassName={styles['status-ring']}
          />
        )}
      </span>
    </Button>
  ) : statusLabel ? (
    // Wordless dot/spinner carries status; the word lives in a tooltip
    <FloatingTooltip content={statusLabel} className={styles['status-tooltip']}>
      {statusSlot}
    </FloatingTooltip>
  ) : (
    statusSlot
  );
  return (
    <div
      ref={rowRef}
      className={clsx(styles['chat-item'], isActive && stateClasses.ACTIVE)}
      onMouseEnter={() => onMouseEnter(chat.id)}
      onMouseLeave={onMouseLeave}
    >
      {/* Right padding reserves room for the timestamp/dropdown so long titles
          truncate before reaching them. */}
      <div className={styles['title-col']}>
        <div className={styles['title-row']}>
          {/* One leading slot keeps all row titles flush: caret on hover/expand,
              otherwise the provider icon + a persistent status dot (or spinner). */}
          {leadingIcon}
          {/* Tooltip wraps only the title, not the icon — so the icon's own status
              tooltip fires on its own hover instead of stacking with this one. */}
          <FloatingTooltip
            content={onOpenInSplit ? `${chat.title} (Shift-click to open in split)` : chat.title}
            className={styles['title-tooltip']}
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
              className={styles['title-btn']}
            >
              <span
                className={clsx(
                  styles['title-text'],
                  (isActive || isUnread) && styles['title-text--emphasis'],
                )}
              >
                {stripMarkdownTitle(chat.title)}
              </span>
              {/* Resting hint that sub-threads exist; the caret conveys it on hover/expand */}
              {hasSubThreads && !isHovered && !isSubThreadsExpanded && (
                <CornerDownRight className={styles['subthread-hint']} />
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
            className={clsx(
              styles['workspace-badge'],
              hasLeadingSlot && styles['workspace-badge--indented'],
            )}
          >
            {workspaceBadge.isCloud && <Cloud className={styles['cloud-icon']} />}
            <span className={styles['workspace-name']}>{workspaceBadge.name}</span>
          </Button>
        )}
      </div>

      {/* Right slot shows the timestamp — status now lives on the leading
          dot/spinner. Hides on hover to reveal the dropdown. */}
      <span
        className={clsx(
          styles.timestamp,
          (isHovered || isActive || isDropdownOpen) && styles['timestamp--hidden'],
        )}
      >
        {getRelativeTime(chat.updated_at)}
      </span>

      <Button
        onClick={(e) => onDropdownClick(e, chat)}
        onMouseDown={(e) => e.stopPropagation()}
        variant="unstyled"
        className={clsx(
          styles['dropdown-btn'],
          (isHovered || isActive || isDropdownOpen) && styles['dropdown-btn--visible'],
        )}
        aria-label="Chat options"
      >
        <MoreHorizontal className={styles['dropdown-icon']} />
      </Button>
    </div>
  );
});
