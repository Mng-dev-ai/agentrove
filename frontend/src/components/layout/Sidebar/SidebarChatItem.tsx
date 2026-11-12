import { memo, useEffect, useRef } from 'react';
import { ChevronRight, CornerDownRight, Server } from 'lucide-react';
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
import type { Chat } from '@/types/chat.types';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import { SidebarRow, SidebarRowTitle } from './SidebarRow';
import styles from './SidebarChatItem.module.scss';

export interface MachineBadge {
  name: string;
  offline: boolean;
}

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
  machineName?: string;
  machineOffline?: boolean;
  onSelect: (chatId: string) => void;
  onOpenInSplit?: (chatId: string) => void;
  canOpenInSplit?: boolean;
  onDropdownClick: (e: React.MouseEvent<HTMLButtonElement>, chat: Chat) => void;
  onMouseEnter: (chatId: string) => void;
  onMouseLeave: () => void;
  onToggleSubThreads?: (chatId: string) => void;
  isSubThreadsExpanded?: boolean;
}

interface SidebarRowBadgesProps {
  machineName?: string;
  machineOffline?: boolean;
  workspaceName?: string;
  isIndented: boolean;
}

export function SidebarRowBadges({
  machineName,
  machineOffline = false,
  workspaceName,
  isIndented,
}: SidebarRowBadgesProps) {
  if (!workspaceName && !machineName) return null;
  return (
    <span
      className={clsx(styles['workspace-badge'], isIndented && styles['workspace-badge--indented'])}
    >
      {machineName && (
        <span
          className={clsx(
            styles['machine-badge'],
            machineOffline && styles['machine-badge--offline'],
          )}
        >
          <Server className={styles['machine-icon']} />
          <span className={styles['workspace-name']}>
            {machineOffline ? `${machineName} · Machine offline` : machineName}
          </span>
        </span>
      )}
      {machineName && workspaceName && <span aria-hidden>·</span>}
      {workspaceName && <span className={styles['workspace-name']}>{workspaceName}</span>}
    </span>
  );
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
  machineName,
  machineOffline = false,
  onSelect,
  onOpenInSplit,
  canOpenInSplit = false,
  onDropdownClick,
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
  const agentKind = useChatAgentKind(chat.id, chat.session_agent_kind, chat.last_model_id);
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
        <ProviderIcon
          agentKind={agentKind}
          className={clsx(
            styles['provider-icon'],
            !isHovered && !isActive && !status && styles['provider-icon--muted'],
          )}
        />
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
    <SidebarRow
      ref={rowRef}
      isActive={isActive}
      isRevealed={isHovered || isActive || isDropdownOpen}
      onMouseEnter={() => onMouseEnter(chat.id)}
      onMouseLeave={onMouseLeave}
      // Single leading slot keeps titles flush (caret vs icon+status).
      leading={leadingIcon}
      title={
        // Tooltip on title only — icon has its own status tooltip.
        <FloatingTooltip
          content={
            onOpenInSplit && canOpenInSplit
              ? `${chat.title} (Shift-click to open in split)`
              : chat.title
          }
          className={styles['title-tooltip']}
        >
          <SidebarRowTitle
            label={stripMarkdownTitle(chat.title)}
            isEmphasized={isActive || isUnread}
            isCurrent={isSelected}
            onClick={(e) => {
              if (e.shiftKey && onOpenInSplit && canOpenInSplit && !isActive) {
                e.preventDefault();
                onOpenInSplit(chat.id);
                return;
              }
              onSelect(chat.id);
            }}
            trailing={
              // Resting sub-thread hint; caret covers this on hover/expand.
              hasSubThreads &&
              !isHovered &&
              !isSubThreadsExpanded && <CornerDownRight className={styles['subthread-hint']} />
            }
          />
        </FloatingTooltip>
      }
      subtitle={
        <SidebarRowBadges
          machineName={machineName}
          machineOffline={machineOffline}
          workspaceName={workspaceBadge?.name}
          isIndented={hasLeadingSlot}
        />
      }
      timestamp={getRelativeTime(chat.updated_at)}
      dropdownLabel="Chat options"
      onDropdownClick={(e) => onDropdownClick(e, chat)}
    />
  );
});
