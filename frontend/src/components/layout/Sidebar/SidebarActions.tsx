import { Inbox, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useInboxAcrossMachines } from '@/hooks/queries/useInboxQueries';
import { IS_MAC_PLATFORM } from '@/utils/platform';
import styles from './SidebarActions.module.scss';

interface SidebarActionsProps {
  onNewChat: () => void;
  onOpenSearch: () => void;
  onOpenInbox: () => void;
}

export function SidebarActions({ onNewChat, onOpenSearch, onOpenInbox }: SidebarActionsProps) {
  const { unreadCount } = useInboxAcrossMachines();

  return (
    <div className={styles.actions}>
      <Button onClick={onNewChat} variant="unstyled" className={styles['new-thread']}>
        <Plus className={styles['action-icon']} />
        New thread
      </Button>
      <Button
        onClick={onOpenSearch}
        variant="unstyled"
        className={styles['search-btn']}
        aria-keyshortcuts={IS_MAC_PLATFORM ? 'Meta+K' : 'Control+K'}
      >
        <Search className={styles['action-icon']} />
        Search
        <kbd className={styles.shortcut} aria-hidden>
          {IS_MAC_PLATFORM ? '⌘K' : 'Ctrl K'}
        </kbd>
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
