import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Inbox,
  Mail,
  MailOpen,
  Server,
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Sidebar } from '@/components/layout/Sidebar/Sidebar';
import { useLayoutSidebar } from '@/components/layout/Layout/layoutState';
import { ChatStatusDot } from '@/components/ui/ChatStatusDot/ChatStatusDot';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { Button } from '@/components/ui/primitives/Button/Button';
import { LoadErrorState } from '@/components/ui/shared/LoadErrorState/LoadErrorState';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import {
  type MachineInboxItem,
  useClearReadInboxMutation,
  useDeleteInboxItemMutation,
  useInboxAcrossMachines,
  useMarkAllInboxReadMutation,
  useMarkInboxReadMutation,
  useMarkInboxUnreadMutation,
} from '@/hooks/queries/useInboxQueries';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useCommandMenu } from '@/hooks/useCommandMenu';
import { formatFullTimestamp, getRelativeTime } from '@/utils/date';
import { stripMarkdownTitle } from '@/utils/format';
import { logger } from '@/utils/logger';
import { machineName } from '@/store/machineStore';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import styles from './InboxPage.module.scss';

const DATE_GROUP_LABELS = ['Today', 'Yesterday', 'Previous 7 days', 'Older'] as const;

interface InboxGroup {
  label: (typeof DATE_GROUP_LABELS)[number];
  entries: MachineInboxItem[];
}

function groupByDate(entries: MachineInboxItem[]): InboxGroup[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);
  const starts = [today, yesterday, weekStart].map((date) => date.getTime());

  const groups = DATE_GROUP_LABELS.map((label) => ({ label, entries: [] as MachineInboxItem[] }));
  for (const entry of entries) {
    const time = Date.parse(entry.item.created_at);
    const index = starts.findIndex((start) => time >= start);
    groups[index === -1 ? starts.length : index].entries.push(entry);
  }
  return groups.filter((group) => group.entries.length > 0);
}

interface InboxRowProps {
  entry: MachineInboxItem;
  onOpen: (entry: MachineInboxItem) => void;
  onToggleRead: (entry: MachineInboxItem) => void;
  onDelete: (entry: MachineInboxItem) => void;
}

function InboxRow({ entry, onOpen, onToggleRead, onDelete }: InboxRowProps) {
  const { item, machineId } = entry;
  const bodyRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [copied, setCopied] = useState(false);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || expanded) return;
    const measure = () => setOverflows(body.scrollHeight > body.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [expanded, item.body]);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(item.body);
      setCopied(true);
    } catch (error) {
      logger.error('Clipboard copy failed', 'InboxPage', error);
    }
  };

  const isRead = item.read_at !== null;
  const readLabel = isRead ? 'Mark unread' : 'Mark read';
  const expandLabel = expanded ? 'Collapse' : 'Expand';
  const copyLabel = copied ? 'Copied' : 'Copy';
  const metaParts = [
    item.chat_title && (
      <span key="chat" className={styles['meta-part']}>
        {stripMarkdownTitle(item.chat_title)}
      </span>
    ),
    item.workspace_name && (
      <span key="workspace" className={clsx(styles['meta-part'], styles['meta-part--fixed'])}>
        {item.workspace_name}
      </span>
    ),
    machineId !== LOCAL_MACHINE_ID && (
      <span key="machine" className={clsx(styles['machine-badge'], styles['meta-part--fixed'])}>
        <Server className={styles['machine-icon']} />
        <span className={styles['meta-part']}>{machineName(machineId)}</span>
      </span>
    ),
  ].filter(Boolean);

  return (
    <div className={clsx(styles.row, isRead && styles['row--read'])}>
      <Button
        type="button"
        variant="unstyled"
        onClick={() => onOpen(entry)}
        className={styles['open-btn']}
      >
        <span className={styles['item-title']}>{item.title}</span>
        <time
          className={styles.time}
          dateTime={item.created_at}
          title={formatFullTimestamp(item.created_at)}
        >
          {getRelativeTime(item.created_at)}
        </time>
        <span ref={bodyRef} className={clsx(styles.body, expanded && styles['body--expanded'])}>
          {item.body}
        </span>
        {metaParts.length > 0 && (
          <span className={styles.meta}>
            {metaParts.flatMap((part, index) =>
              index === 0
                ? [part]
                : [
                    <span key={`separator-${index}`} aria-hidden className={styles.separator}>
                      ·
                    </span>,
                    part,
                  ],
            )}
          </span>
        )}
      </Button>
      {!isRead && (
        <Button
          type="button"
          variant="unstyled"
          tabIndex={-1}
          aria-label="Mark read"
          className={styles['dot-btn']}
          onClick={() => onToggleRead(entry)}
        >
          <ChatStatusDot tone="unread" />
        </Button>
      )}
      <div className={styles.actions}>
        <Tooltip content={readLabel} position="top">
          <Button
            type="button"
            variant="unstyled"
            aria-label={readLabel}
            className={styles['action-btn']}
            onClick={() => onToggleRead(entry)}
          >
            {isRead ? (
              <Mail className={styles['action-icon']} />
            ) : (
              <MailOpen className={styles['action-icon']} />
            )}
          </Button>
        </Tooltip>
        {(overflows || expanded) && (
          <Tooltip content={expandLabel} position="top">
            <Button
              type="button"
              variant="unstyled"
              aria-label={expandLabel}
              aria-expanded={expanded}
              className={styles['action-btn']}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? (
                <ChevronsDownUp className={styles['action-icon']} />
              ) : (
                <ChevronsUpDown className={styles['action-icon']} />
              )}
            </Button>
          </Tooltip>
        )}
        <Tooltip content={copyLabel} position="top">
          <Button
            type="button"
            variant="unstyled"
            aria-label={copyLabel}
            className={styles['action-btn']}
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <Check className={styles['action-icon']} />
            ) : (
              <Copy className={styles['action-icon']} />
            )}
          </Button>
        </Tooltip>
        <Tooltip content="Delete" position="top">
          <Button
            type="button"
            variant="unstyled"
            aria-label="Delete"
            className={styles['action-btn']}
            onClick={() => onDelete(entry)}
          >
            <Trash2 className={styles['action-icon']} />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

export function InboxPage() {
  const navigate = useNavigate();
  useCommandMenu();
  const workspaces = useWorkspacesList();
  const {
    machineIds,
    items,
    unreadCount,
    hasReadItems,
    isLoading,
    load,
    hasMore,
    isFetchingMore,
    loadMore,
  } = useInboxAcrossMachines();
  const markRead = useMarkInboxReadMutation();
  const markUnread = useMarkInboxUnreadMutation();
  const deleteItem = useDeleteInboxItemMutation();
  const markAllRead = useMarkAllInboxReadMutation();
  const clearRead = useClearReadInboxMutation();

  const sidebarContent = useMemo(
    () => (
      <Sidebar
        workspaces={workspaces}
        selectedChatId={null}
        selectedChannelId={null}
        onChatSelect={(chatId) => navigate(`/chat/${chatId}`)}
      />
    ),
    [workspaces, navigate],
  );

  useLayoutSidebar(sidebarContent);

  const groups = useMemo(() => groupByDate(items), [items]);

  const openItem = ({ item, machineId }: MachineInboxItem) => {
    if (!item.read_at) markRead.mutate({ itemId: item.id, machineId });
    navigate(`/chat/${item.chat_id}`);
  };

  const reportFailures = (action: string) => (failed: string[]) => {
    if (failed.length > 0)
      toast.error(`Couldn't ${action} on ${failed.map(machineName).join(', ')}`);
  };

  const reportFailure = (action: string, machineId: string) => () =>
    toast.error(`Couldn't ${action} on ${machineName(machineId)}`);

  const toggleRead = ({ item, machineId }: MachineInboxItem) => {
    const variables = { itemId: item.id, machineId };
    if (item.read_at) {
      markUnread.mutate(variables, { onError: reportFailure('mark unread', machineId) });
    } else {
      markRead.mutate(variables, { onError: reportFailure('mark read', machineId) });
    }
  };

  const removeItem = ({ item, machineId }: MachineInboxItem) =>
    deleteItem.mutate(
      { itemId: item.id, machineId },
      { onError: reportFailure('delete message', machineId) },
    );

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles['header-row']}>
          <div>
            <div className={styles['title-row']}>
              <h2 className={styles.title}>Inbox</h2>
              {unreadCount > 0 && (
                <span className={styles['unread-count']}>{unreadCount} unread</span>
              )}
            </div>
            <p className={styles.description}>Messages your agents sent you while they worked</p>
          </div>
          <div className={styles['header-actions']}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={styles['mark-all-btn']}
              disabled={unreadCount === 0 || markAllRead.isPending}
              onClick={() =>
                markAllRead.mutate(machineIds, { onSuccess: reportFailures('mark all read') })
              }
            >
              Mark all read
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={styles['mark-all-btn']}
              disabled={!hasReadItems || clearRead.isPending}
              onClick={() =>
                clearRead.mutate(machineIds, { onSuccess: reportFailures('clear read') })
              }
            >
              Clear read
            </Button>
          </div>
        </div>

        {items.length === 0 && load.loadFailed ? (
          <LoadErrorState icon={AlertCircle} message="Couldn't load your inbox" load={load} />
        ) : isLoading ? (
          <div className={styles.loading}>
            <Spinner size="md" className={styles.spinner} />
          </div>
        ) : items.length === 0 ? (
          <div className={styles.empty}>
            <Inbox className={styles['empty-icon']} />
            <p className={styles['empty-text']}>No messages yet</p>
          </div>
        ) : (
          <div className={styles.list}>
            {groups.map((group) => (
              <section key={group.label} className={styles.group}>
                <h3 className={styles['group-label']}>{group.label}</h3>
                {group.entries.map((entry) => (
                  <InboxRow
                    key={entry.item.id}
                    entry={entry}
                    onOpen={openItem}
                    onToggleRead={toggleRead}
                    onDelete={removeItem}
                  />
                ))}
              </section>
            ))}
            {hasMore && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={styles['show-more-btn']}
                disabled={isFetchingMore}
                onClick={loadMore}
              >
                {isFetchingMore ? 'Loading…' : 'Show more'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
