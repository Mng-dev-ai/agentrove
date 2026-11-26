import type { MouseEvent } from 'react';
import { useMatch } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { DROPDOWN_MARGIN } from '@/config/constants';
import { useChannelQuery } from '@/hooks/queries/useChannelQueries';
import { useUIStore } from '@/store/uiStore';
import paneStyles from '@/components/layout/PaneHeader/PaneHeader.module.scss';
import styles from './ChannelHeader.module.scss';

export function ChannelHeader() {
  const channelId = useMatch('/channels/:channelId')?.params.channelId;
  const { data: channel } = useChannelQuery(channelId);
  const menuOpen = useUIStore(
    (s) => s.channelMenu?.source === 'title' && s.channelMenu.channel.id === channelId,
  );

  if (!channel) return null;

  const toggleMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    useUIStore.getState().toggleChannelMenu({
      channel,
      position: {
        top: rect.bottom + 4,
        right: Math.max(DROPDOWN_MARGIN, window.innerWidth - rect.right),
      },
      source: 'title',
    });
  };

  return (
    <div className={styles.header}>
      <span className={styles.title}>#{channel.name}</span>
      <Button
        type="button"
        variant="unstyled"
        className={paneStyles.chevron}
        onClick={toggleMenu}
        data-channel-menu-trigger
        aria-label="Channel menu"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <ChevronDown className={paneStyles['chevron-icon']} />
      </Button>
    </div>
  );
}
