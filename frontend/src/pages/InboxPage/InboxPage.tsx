import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar/Sidebar';
import { useLayoutSidebar } from '@/components/layout/Layout/layoutState';
import { ChatStatusDot } from '@/components/ui/ChatStatusDot/ChatStatusDot';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import {
  useInboxQuery,
  useMarkAllInboxReadMutation,
  useMarkInboxReadMutation,
} from '@/hooks/queries/useInboxQueries';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useCommandMenu } from '@/hooks/useCommandMenu';
import { formatRelativeTime } from '@/utils/date';
import type { InboxItem } from '@/types/inbox.types';
import styles from './InboxPage.module.scss';

export function InboxPage() {
  const navigate = useNavigate();
  useCommandMenu();
  const workspaces = useWorkspacesList();
  const { data, isLoading } = useInboxQuery();
  const markRead = useMarkInboxReadMutation();
  const markAllRead = useMarkAllInboxReadMutation();

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

  const items = data?.items ?? [];
  const unreadCount = data?.unread_count ?? 0;

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
              <Button
                key={item.id}
                type="button"
                variant="unstyled"
                onClick={() => openItem(item)}
                className={styles.row}
              >
                <span className={styles['status-slot']}>
                  {!item.read_at && <ChatStatusDot tone="unread" />}
                </span>
                <span className={styles.text}>
                  <span className={styles['item-title']}>{item.title}</span>
                  <span className={styles.body}>{item.body}</span>
                </span>
                <span className={styles.time}>{formatRelativeTime(item.created_at)}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
