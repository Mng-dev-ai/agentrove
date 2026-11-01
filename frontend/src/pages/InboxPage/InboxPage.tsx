import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar/Sidebar';
import { useLayoutSidebar } from '@/components/layout/Layout/layoutState';
import { ChatStatusDot } from '@/components/ui/ChatStatusDot/ChatStatusDot';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import {
  useClearReadInboxMutation,
  useInboxQuery,
  useMarkAllInboxReadMutation,
  useMarkInboxReadMutation,
} from '@/hooks/queries/useInboxQueries';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useCommandMenu } from '@/hooks/useCommandMenu';
import { formatRelativeTime } from '@/utils/date';
import { logger } from '@/utils/logger';
import type { InboxItem } from '@/types/inbox.types';
import styles from './InboxPage.module.scss';

interface InboxRowProps {
  item: InboxItem;
  onOpen: (item: InboxItem) => void;
}

function InboxRow({ item, onOpen }: InboxRowProps) {
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

  return (
    <div className={styles.row}>
      <Button
        type="button"
        variant="unstyled"
        onClick={() => onOpen(item)}
        className={styles['open-btn']}
      >
        <span className={styles['status-slot']}>
          {!item.read_at && <ChatStatusDot tone="unread" />}
        </span>
        <span className={styles.text}>
          <span className={styles['item-title']}>{item.title}</span>
          <span ref={bodyRef} className={clsx(styles.body, expanded && styles['body--expanded'])}>
            {item.body}
          </span>
        </span>
        <span className={styles.time}>{formatRelativeTime(item.created_at)}</span>
      </Button>
      <div className={styles.footer}>
        {(overflows || expanded) && (
          <Button
            type="button"
            variant="unstyled"
            className={styles['footer-btn']}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Show less' : 'Show more'}
          </Button>
        )}
        <Button
          type="button"
          variant="unstyled"
          className={styles['footer-btn']}
          onClick={() => void handleCopy()}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

export function InboxPage() {
  const navigate = useNavigate();
  useCommandMenu();
  const workspaces = useWorkspacesList();
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useInboxQuery();
  const markRead = useMarkInboxReadMutation();
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

  const items = data?.pages.flatMap((page) => page.items) ?? [];
  const unreadCount = data?.pages[0]?.unread_count ?? 0;
  // Unloaded pages may still hold read items.
  const hasReadItems = hasNextPage || items.some((item) => item.read_at);

  const openItem = (item: InboxItem) => {
    if (!item.read_at) markRead.mutate(item.id);
    navigate(`/chat/${item.chat_id}`);
  };

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles['header-row']}>
          <div>
            <h2 className={styles.title}>Inbox</h2>
            <p className={styles.description}>Messages your agents sent you while they worked</p>
          </div>
          <div className={styles['header-actions']}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={styles['mark-all-btn']}
              disabled={unreadCount === 0 || markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              Mark all read
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={styles['mark-all-btn']}
              disabled={!hasReadItems || clearRead.isPending}
              onClick={() => clearRead.mutate()}
            >
              Clear read
            </Button>
          </div>
        </div>

        {isLoading ? (
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
            {items.map((item) => (
              <InboxRow key={item.id} item={item} onOpen={openItem} />
            ))}
            {hasNextPage && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={styles['load-more-btn']}
                disabled={isFetchingNextPage}
                onClick={() => fetchNextPage()}
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
