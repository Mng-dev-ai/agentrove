import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './SidebarActions.module.scss';

interface SidebarActionsProps {
  onNewChat: () => void;
  onOpenSearch: () => void;
}

export function SidebarActions({ onNewChat, onOpenSearch }: SidebarActionsProps) {
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
    </div>
  );
}
