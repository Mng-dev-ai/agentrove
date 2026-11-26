import { Inbox, Search, SquarePen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { useInboxAcrossMachines } from '@/hooks/queries/useInboxQueries';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useUIStore } from '@/store/uiStore';
import { IS_MAC_PLATFORM } from '@/utils/platform';
import styles from './TitleBar.module.scss';

const SEARCH_SHORTCUT = IS_MAC_PLATFORM ? '⌘K' : 'Ctrl K';

export function TitleBarActions() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { unreadCount } = useInboxAcrossMachines();

  // The mobile sidebar is a drawer over the page; close it so the destination shows.
  const closeMobileDrawer = () => {
    if (isMobile) useUIStore.getState().setSidebarOpen(false);
  };

  return (
    <div className={styles.actions}>
      <FloatingTooltip content={`Search ${SEARCH_SHORTCUT}`}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={styles['icon-button']}
          onClick={() => {
            useUIStore.getState().setCommandMenuOpen(true);
            closeMobileDrawer();
          }}
          aria-label="Search"
          aria-keyshortcuts={IS_MAC_PLATFORM ? 'Meta+K' : 'Control+K'}
        >
          <Search className={styles['icon-button-glyph']} />
        </Button>
      </FloatingTooltip>
      <FloatingTooltip content="Inbox">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={styles['icon-button']}
          onClick={() => {
            navigate('/inbox');
            closeMobileDrawer();
          }}
          aria-label="Inbox"
        >
          <Inbox className={styles['icon-button-glyph']} />
          {unreadCount > 0 && (
            <span className={styles.badge} aria-label={`${unreadCount} unread`}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </FloatingTooltip>
      <FloatingTooltip content="New thread">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={styles['icon-button']}
          onClick={() => {
            navigate('/');
            closeMobileDrawer();
          }}
          aria-label="New thread"
        >
          <SquarePen className={styles['icon-button-glyph']} />
        </Button>
      </FloatingTooltip>
    </div>
  );
}
