import { Inbox, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useInboxQuery } from '@/hooks/queries/useInboxQueries';
import styles from './SidebarActions.module.scss';

interface SidebarActionsProps {
  onNewChat: () => void;
  onOpenSearch: () => void;
  onOpenInbox: () => void;
}

export function SidebarActions({ onNewChat, onOpenSearch, onOpenInbox }: SidebarActionsProps) {
  const { data } = useInboxQuery();
  const unreadCount = data?.unread_count ?? 0;

  return (
    <div className={styles.actions}>
      <Button onClick={onNewChat} variant="unstyled" className={styles['new-thread']}>
        <Plus className={styles['action-icon']} />
        New thread
      </Button>
      <Button onClick={onOpenSearch} variant="unstyled" className={styles['search-btn']}>
        <Search className={styles['action-icon']} />
        Search
      </Button>
      <Button onClick={onOpenInbox} variant="unstyled" className={styles['search-btn']}>
        <Inbox className={styles['action-icon']} />
        Inbox
        {unreadCount > 0 && (
          <span className={styles.badge} aria-label={`${unreadCount} unread`}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>
    </div>
  );
}
