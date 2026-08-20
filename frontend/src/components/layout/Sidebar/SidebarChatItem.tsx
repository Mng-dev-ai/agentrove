import { memo, useEffect, useRef } from 'react';
import { ChevronRight, Cloud, CornerDownRight, MoreHorizontal } from 'lucide-react';
import { AsciiSpinner } from '@/components/ui/AsciiSpinner/AsciiSpinner';
import { ChatStatusDot } from '@/components/ui/ChatStatusDot/ChatStatusDot';
import { chatStatusTone, CHAT_STATUS_LABEL, type ChatStatusTone } from '@/utils/message';
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
  canOpenInSplit?: boolean;
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
  canOpenInSplit = false,
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
  const statusLabel = status ? CHAT_STATUS_LABEL[status] : null;
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
      {/* Pad for timestamp/dropdown so long titles truncate before them. */}
      <div className={styles['title-col']}>
        <div className={styles['title-row']}>
          {/* Single leading slot keeps titles flush (caret vs icon+status). */}
          {leadingIcon}
          {/* Tooltip on title only — icon has its own status tooltip. */}
          <FloatingTooltip
            content={
              onOpenInSplit && canOpenInSplit
                ? `${chat.title} (Shift-click to open in split)`
                : chat.title
            }
            className={styles['title-tooltip']}
          >
            <Button
              onClick={(e) => {
                if (e.shiftKey && onOpenInSplit && canOpenInSplit && !isActive) {
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
              {/* Resting sub-thread hint; caret covers this on hover/expand. */}
              {hasSubThreads && !isHovered && !isSubThreadsExpanded && (
                <CornerDownRight className={styles['subthread-hint']} />
              )}
            </Button>
          </FloatingTooltip>
        </div>
        {/* Badge opens workspace menu (flat list has no group headers for those actions). */}
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

      {/* Timestamp; hides on hover for the dropdown. Status is on the leading icon. */}
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
