import { Fragment, memo, useEffect, useRef } from 'react';
import { ChevronRight, CornerDownRight } from 'lucide-react';
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
import { describeMachine } from './sidebarHelpers';
import type { ChildActivity } from './useSidebarActivity';
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
  machineBadge?: MachineBadge;
  onSelect: (chatId: string) => void;
  onOpenInSplit?: (chatId: string) => void;
  canOpenInSplit?: boolean;
  onDropdownClick: (e: React.MouseEvent<HTMLButtonElement>, chat: Chat) => void;
  onMouseEnter: (chatId: string) => void;
  onMouseLeave: () => void;
  onToggleSubThreads?: (chatId: string) => void;
  isSubThreadsExpanded?: boolean;
  // Channels nested in the same child list as the sub-threads
  linkedChannelCount: number;
  // Running/blocked sub-threads and linked channels, surfaced while the parent is collapsed
  childActivity?: ChildActivity;
  // Set in the flat activity list, where sub-threads appear without their parent row
  parentTitle?: string;
}

function describeChildActivity({ running, needsYou }: ChildActivity): string {
  return [needsYou > 0 && `${needsYou} needs you`, running > 0 && `${running} running`]
    .filter(Boolean)
    .join(' · ');
}

function describeChildren(subThreadCount: number, channelCount: number): string {
  return [
    subThreadCount > 0 && `${subThreadCount} sub-threads`,
    channelCount > 0 && `${channelCount} linked channels`,
  ]
    .filter(Boolean)
    .join(' and ');
}

function ChildActivityCounts({ activity }: { activity: ChildActivity }) {
  return (
    <span
      className={styles['child-activity']}
      aria-label={`Nested: ${describeChildActivity(activity)}`}
    >
      {activity.needsYou > 0 && (
        <span className={styles['child-count']}>
          <ChatStatusDot tone="blocked" />
          {activity.needsYou}
        </span>
      )}
      {activity.running > 0 && (
        <span className={clsx(styles['child-count'], styles['child-count--running'])}>
          <AsciiSpinner />
          {activity.running}
        </span>
      )}
    </span>
  );
}

interface SidebarRowPreviewProps {
  title: string;
  detail: string;
  facts: [label: string, value: string | undefined][];
}

export function SidebarRowPreview({ title, detail, facts }: SidebarRowPreviewProps) {
  const shownFacts = facts.filter(([, value]) => value);
  return (
    <span className={styles.preview}>
      <span className={styles['preview-title']}>{title}</span>
      <span className={styles['preview-detail']}>{detail}</span>
      {shownFacts.length > 0 && (
        <span className={styles['preview-facts']}>
          {shownFacts.map(([label, value]) => (
            <Fragment key={label}>
              <span className={styles['preview-label']}>{label}</span>
              <span>{value}</span>
            </Fragment>
          ))}
        </span>
      )}
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
  machineBadge,
  onSelect,
  onOpenInSplit,
  canOpenInSplit = false,
  onDropdownClick,
  onMouseEnter,
  onMouseLeave,
  onToggleSubThreads,
  isSubThreadsExpanded,
  linkedChannelCount,
  childActivity,
  parentTitle,
}: SidebarChatItemProps) {
  // onToggleSubThreads is only set when the chat has sub-threads or linked channels
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
  const hasLeadingSlot = hasSubThreads || agentKind != null || status != null;
  const statusSlot = hasLeadingSlot ? (
    // Running swaps to a spinner; blocked/done/unread show a colored dot on the icon
    // corner. The status word is in the hover preview and the accessible name.
    <span
      className={styles['status-slot']}
      role={statusLabel ? 'img' : undefined}
      aria-label={statusLabel ?? undefined}
    >
      {showSpinner ? (
        <AsciiSpinner className={styles['item-spinner']} />
      ) : agentKind ? (
        <ProviderIcon
          agentKind={agentKind}
          className={clsx(
            styles['provider-icon'],
            !isHovered && !isActive && styles['provider-icon--muted'],
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
  const showCaret = isHovered || isSubThreadsExpanded;
  // The caret stays mounted so a tap never lands on a swapped element; CSS hides it at
  // rest on hover-capable devices and shows it at rest on touch.
  const leadingIcon = hasSubThreads ? (
    <>
      <Button
        onClick={() => onToggleSubThreads(chat.id)}
        aria-expanded={isSubThreadsExpanded}
        // The caret covers the labelled status icon, so it carries the status word too
        aria-label={[
          `${isSubThreadsExpanded ? 'Collapse' : 'Expand'} ${describeChildren(chat.sub_thread_count, linkedChannelCount)}`,
          statusLabel,
        ]
          .filter(Boolean)
          .join(' · ')}
        variant="unstyled"
        className={clsx(styles['caret-btn'], !showCaret && styles['caret-btn--resting'])}
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
      {!showCaret && <span className={styles['resting-status']}>{statusSlot}</span>}
    </>
  ) : (
    statusSlot
  );
  const preview = (
    <SidebarRowPreview
      title={stripMarkdownTitle(chat.title)}
      detail={[
        `Updated ${getRelativeTime(chat.updated_at)}`,
        statusLabel,
        onOpenInSplit && canOpenInSplit ? 'Shift-click to open in split' : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      facts={[
        ['Machine', describeMachine(machineBadge)],
        ['Workspace', workspaceBadge?.name],
        ['Sub-threads', chat.sub_thread_count > 0 ? String(chat.sub_thread_count) : undefined],
        ['Channels', linkedChannelCount > 0 ? String(linkedChannelCount) : undefined],
        ['Nested', childActivity && describeChildActivity(childActivity)],
        ['Parent', parentTitle],
      ]}
    />
  );
  return (
    // The preview opens beside the whole row, past the sidebar edge, so the rows
    // below stay readable.
    <FloatingTooltip content={preview} placement="right">
      <SidebarRow
        ref={rowRef}
        isActive={isActive}
        isRevealed={isHovered || isActive || isDropdownOpen}
        onMouseEnter={() => onMouseEnter(chat.id)}
        onMouseLeave={onMouseLeave}
        // Single leading slot keeps titles flush (caret vs icon+status).
        leading={leadingIcon}
        title={
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
              // Resting sub-thread hint; caret covers this on hover/expand and on touch.
              hasSubThreads &&
              !showCaret && <CornerDownRight className={styles['subthread-hint']} />
            }
          />
        }
        subtitle={
          parentTitle && (
            <span className={styles['parent-context']}>
              <CornerDownRight className={styles['parent-context-icon']} />
              <span className={styles['parent-context-title']}>{parentTitle}</span>
            </span>
          )
        }
        timestamp={
          childActivity ? (
            <ChildActivityCounts activity={childActivity} />
          ) : (
            getRelativeTime(chat.updated_at)
          )
        }
        isTimestampStatus={childActivity != null}
        dropdownLabel="Chat options"
        onDropdownClick={(e) => onDropdownClick(e, chat)}
      />
    </FloatingTooltip>
  );
});
