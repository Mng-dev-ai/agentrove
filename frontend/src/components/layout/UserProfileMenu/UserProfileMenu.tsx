import { Settings, LogOut } from 'lucide-react';
import clsx from 'clsx';
import { UserAvatarCircle } from '@/components/chat/message-bubble/MessageAvatars';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useDesktopUpdateStore, type DesktopUpdateState } from '@/store/updateStore';
import { useUIStore } from '@/store/uiStore';
import { useDropdown } from '@/hooks/useDropdown';
import { formatBytes } from '@/utils/format';
import {
  downloadDesktopUpdate,
  installDesktopUpdate,
  retryDesktopUpdate,
} from '@/services/desktopUpdateService';
import { getThemeMeta } from '@/utils/theme';
import styles from './UserProfileMenu.module.scss';

interface UserProfileMenuProps {
  displayName: string | undefined;
  onOpenSettings: () => void;
  onSignOut: () => void;
}

interface UpdatePill {
  label: string;
  tone: 'action' | 'neutral' | 'error';
  description: string;
  action: (() => Promise<void>) | null;
}

function updatePill(update: DesktopUpdateState): UpdatePill | null {
  switch (update.status) {
    case 'idle':
      return null;
    case 'available':
      return {
        label: 'Update',
        tone: 'action',
        description: `Update to ${update.version}`,
        action: downloadDesktopUpdate,
      };
    case 'downloading': {
      const { downloadedBytes, totalBytes } = update;
      if (!totalBytes) {
        return {
          label: 'Updating',
          tone: 'neutral',
          description: `Downloading update · ${formatBytes(downloadedBytes)}`,
          action: null,
        };
      }
      const percent = Math.round(Math.min(1, downloadedBytes / totalBytes) * 100);
      return {
        label: `${percent}%`,
        tone: 'neutral',
        description: `Downloading update · ${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)}`,
        action: null,
      };
    }
    case 'ready':
      return {
        label: 'Restart',
        tone: 'action',
        description: `Restart to install ${update.version}`,
        action: installDesktopUpdate,
      };
    case 'installing':
      return {
        label: 'Installing',
        tone: 'neutral',
        description: 'Installing update',
        action: null,
      };
    case 'error':
      return {
        label: 'Retry',
        tone: 'error',
        description: update.message,
        action: retryDesktopUpdate,
      };
  }
}

export function UserProfileMenu({ displayName, onOpenSettings, onSignOut }: UserProfileMenuProps) {
  const update = useDesktopUpdateStore((s) => s.update);

  const theme = useUIStore((s) => s.theme);
  const themeMeta = getThemeMeta(theme);
  const ThemeIcon = themeMeta.icon;

  const { isOpen, dropdownRef, setIsOpen } = useDropdown();

  const pill = updatePill(update);

  return (
    <div ref={dropdownRef} className={styles['user-profile-menu']}>
      <Button
        variant="unstyled"
        onClick={() => setIsOpen((v) => !v)}
        className={styles.trigger}
        aria-label="Open user menu"
      >
        <span className={styles['avatar-wrap']}>
          <UserAvatarCircle displayName={displayName ?? ''} size="large" />
        </span>
        {displayName && <span className={styles.name}>{displayName}</span>}
      </Button>
      {pill && (
        <Button
          variant="unstyled"
          onClick={() => {
            pill.action?.().catch((error) => {
              console.error('Desktop update failed:', error);
            });
          }}
          aria-disabled={pill.action === null}
          aria-label={pill.description}
          title={pill.description}
          className={clsx(styles['update-pill'], styles[`update-pill--${pill.tone}`])}
        >
          {pill.label}
        </Button>
      )}

      {isOpen && (
        <div className={styles.panel}>
          <div className={styles['menu-list']}>
            <Button
              variant="unstyled"
              onClick={() => useUIStore.getState().toggleTheme()}
              className={styles['menu-item']}
            >
              <ThemeIcon className={styles['item-icon']} />
              <span className={styles['item-label']}>Theme</span>
              <span className={styles['item-value']}>{themeMeta.label}</span>
            </Button>
            <Button
              variant="unstyled"
              onClick={() => {
                setIsOpen(false);
                onOpenSettings();
              }}
              className={styles['menu-item']}
            >
              <Settings className={styles['item-icon']} />
              <span className={styles['item-text']}>Settings</span>
            </Button>
            <Button
              variant="unstyled"
              onClick={() => {
                setIsOpen(false);
                onSignOut();
              }}
              className={styles['menu-item']}
            >
              <LogOut className={styles['item-icon']} />
              <span className={styles['item-text']}>Sign out</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
