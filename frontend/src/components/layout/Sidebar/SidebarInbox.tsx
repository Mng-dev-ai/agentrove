import { useLocation, useNavigate } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { useInboxQuery } from '@/hooks/queries/useInboxQueries';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useUIStore } from '@/store/uiStore';
import { SidebarRow, SidebarRowTitle } from './SidebarRow';
import { SidebarSectionHeader } from './SidebarSectionHeader';
import styles from './SidebarInbox.module.scss';

export function SidebarInbox() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isActive = useLocation().pathname === '/inbox';
  const { data } = useInboxQuery();
  const unreadCount = data?.unread_count ?? 0;
  const isCollapsed = useUIStore((state) => state.collapsedSidebarSections.includes('inbox'));

  const openInbox = () => {
    navigate('/inbox');
    if (isMobile) useUIStore.getState().setSidebarOpen(false);
  };

  return (
    <div className={styles.inbox}>
      <SidebarSectionHeader title="Inbox" section="inbox" />
      {(!isCollapsed || isActive) && (
        <SidebarRow
          isActive={isActive}
          isRevealed={false}
          onMouseEnter={() => undefined}
          onMouseLeave={() => undefined}
          leading={<Inbox className={styles.icon} />}
          title={
            <SidebarRowTitle
              label="Messages"
              isEmphasized={isActive || unreadCount > 0}
              isCurrent={isActive}
              onClick={openInbox}
            />
          }
          timestamp={
            unreadCount > 0 && (
              <span className={styles.badge} aria-label={`${unreadCount} unread`}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )
          }
        />
      )}
    </div>
  );
}
