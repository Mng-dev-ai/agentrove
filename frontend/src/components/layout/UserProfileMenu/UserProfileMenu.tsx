import { Download, Loader2, AlertCircle, Settings, LogOut } from 'lucide-react';
import clsx from 'clsx';
import { UserAvatarCircle } from '@/components/chat/message-bubble/MessageAvatars';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useDesktopUpdateStore } from '@/store/updateStore';
import { useUIStore } from '@/store/uiStore';
import { useDropdown } from '@/hooks/useDropdown';
import { formatBytes } from '@/utils/format';
import { checkDesktopUpdate } from '@/services/desktopUpdateService';
import { getThemeMeta } from '@/utils/theme';
import styles from './UserProfileMenu.module.scss';

interface UserProfileMenuProps {
  displayName: string | undefined;
  onOpenSettings: () => void;
  onSignOut: () => void;
}

export function UserProfileMenu({ displayName, onOpenSettings, onSignOut }: UserProfileMenuProps) {
  const updateStatus = useDesktopUpdateStore((s) => s.status);
  const updateVersion = useDesktopUpdateStore((s) => s.version);
  const downloadedBytes = useDesktopUpdateStore((s) => s.downloadedBytes);
  const totalBytes = useDesktopUpdateStore((s) => s.totalBytes);
  const releaseNotes = useDesktopUpdateStore((s) => s.releaseNotes);
  const errorMessage = useDesktopUpdateStore((s) => s.errorMessage);

  const theme = useUIStore((s) => s.theme);
  const themeMeta = getThemeMeta(theme);
  const ThemeIcon = themeMeta.icon;

  const { isOpen, dropdownRef, setIsOpen } = useDropdown();

  const hasUpdate = updateStatus !== 'idle';
  const progress = totalBytes && totalBytes > 0 ? Math.min(1, downloadedBytes / totalBytes) : null;

  function handleInstall() {
    const trigger = useDesktopUpdateStore.getState().triggerInstall;
    if (!trigger) return;
    void trigger();
  }

  function handleRetry() {
    checkDesktopUpdate().catch((error) => {
      console.error('Desktop updater retry failed:', error);
    });
  }

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
          {hasUpdate && <span className={styles['update-dot']} />}
        </span>
        {displayName && <span className={styles.name}>{displayName}</span>}
      </Button>

      {isOpen && (
        <div className={styles.panel}>
          {hasUpdate && (
            <div className={styles['update-section']}>
              {updateStatus === 'downloading' && (
                <div className={styles['update-downloading']}>
                  <Loader2
                    className={clsx(
                      styles['update-icon'],
                      styles['update-icon--top'],
                      styles['update-icon--spin'],
                    )}
                  />
                  <div className={styles['update-text']}>
                    <div className={styles['update-title']}>
                      Downloading update
                      {progress != null ? ` · ${Math.round(progress * 100)}%` : ''}
                    </div>
                    <div className={styles['update-subtitle']}>
                      {totalBytes != null
                        ? `${formatBytes(downloadedBytes)} of ${formatBytes(totalBytes)}`
                        : formatBytes(downloadedBytes)}
                    </div>
                  </div>
                </div>
              )}

              {updateStatus === 'available' && (
                <Button
                  variant="unstyled"
                  onClick={() => {
                    setIsOpen(false);
                    handleInstall();
                  }}
                  className={styles['update-action']}
                >
                  <Download
                    className={clsx(
                      styles['update-icon'],
                      styles['update-icon--top'],
                      styles['update-icon--primary'],
                    )}
                  />
                  <div className={styles['update-text']}>
                    <div className={styles['update-title']}>Update to {updateVersion}</div>
                    <div className={styles['update-subtitle']}>Download and restart</div>
                    {releaseNotes && (
                      <div className={styles['update-notes']}>{releaseNotes.trim()}</div>
                    )}
                  </div>
                </Button>
              )}

              {updateStatus === 'installing' && (
                <div className={styles['update-installing']}>
                  <Loader2 className={clsx(styles['update-icon'], styles['update-icon--spin'])} />
                  <div className={styles['update-title']}>Installing…</div>
                </div>
              )}

              {updateStatus === 'error' && (
                <Button
                  variant="unstyled"
                  onClick={() => {
                    setIsOpen(false);
                    handleRetry();
                  }}
                  className={styles['update-action']}
                >
                  <AlertCircle
                    className={clsx(
                      styles['update-icon'],
                      styles['update-icon--top'],
                      styles['update-icon--error'],
                    )}
                  />
                  <div className={styles['update-text']}>
                    <div className={styles['update-title']}>Update failed — retry</div>
                    {errorMessage && (
                      <div className={styles['update-error-msg']}>{errorMessage}</div>
                    )}
                  </div>
                </Button>
              )}
            </div>
          )}

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
