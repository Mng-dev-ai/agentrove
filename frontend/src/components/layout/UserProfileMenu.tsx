import { Download, Loader2, AlertCircle, Settings, LogOut } from 'lucide-react';
import { UserAvatarCircle } from '@/components/chat/message-bubble/MessageAvatars';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useDesktopUpdateStore } from '@/store/updateStore';
import { useUIStore } from '@/store/uiStore';
import { useDropdown } from '@/hooks/useDropdown';
import { formatBytes } from '@/utils/format';
import { checkDesktopUpdate } from '@/services/desktopUpdateService';
import { getThemeMeta } from '@/utils/theme';
import { cn } from '@/utils/cn';

const MENU_ITEM_CLASS =
  'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ' +
  'text-text-secondary hover:bg-surface-hover hover:text-text-primary ' +
  'dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary ' +
  'transition-colors duration-200';

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
    <div ref={dropdownRef} className="relative flex items-center gap-2.5">
      <Button
        variant="unstyled"
        onClick={() => setIsOpen((v) => !v)}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left"
        aria-label="Open user menu"
      >
        <span className="relative flex-shrink-0">
          <UserAvatarCircle displayName={displayName} size="large" />
          {hasUpdate && (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full',
                'bg-text-primary dark:bg-text-dark-primary',
                'ring-2 ring-surface-secondary dark:ring-surface-dark-secondary',
              )}
            />
          )}
        </span>
        {displayName && (
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary dark:text-text-dark-primary">
            {displayName}
          </span>
        )}
      </Button>

      {isOpen && (
        <div
          className={cn(
            'absolute bottom-full left-0 z-50 mb-2 w-64 animate-fade-in',
            'rounded-xl border border-border/50 bg-surface-secondary shadow-medium',
            'dark:border-border-dark/50 dark:bg-surface-dark-secondary',
          )}
        >
          {hasUpdate && (
            <div className="border-b border-border/50 p-2 dark:border-border-dark/50">
              {updateStatus === 'downloading' && (
                <div
                  className={cn(
                    'flex items-start gap-2.5 rounded-md px-2 py-1.5',
                    'text-text-secondary dark:text-text-dark-secondary',
                  )}
                >
                  <Loader2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 animate-spin" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                      Downloading update
                      {progress != null ? ` · ${Math.round(progress * 100)}%` : ''}
                    </div>
                    <div className="mt-0.5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
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
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left',
                    'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
                    'transition-colors duration-200',
                  )}
                >
                  <Download className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-text-primary dark:text-text-dark-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                      Update to {updateVersion}
                    </div>
                    <div className="mt-0.5 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                      Download and restart
                    </div>
                    {releaseNotes && (
                      <div className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-2xs leading-relaxed text-text-tertiary dark:text-text-dark-tertiary">
                        {releaseNotes.trim()}
                      </div>
                    )}
                  </div>
                </Button>
              )}

              {updateStatus === 'installing' && (
                <div
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2 py-1.5',
                    'text-text-secondary dark:text-text-dark-secondary',
                  )}
                >
                  <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" />
                  <div className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                    Installing…
                  </div>
                </div>
              )}

              {updateStatus === 'error' && (
                <Button
                  variant="unstyled"
                  onClick={() => {
                    setIsOpen(false);
                    handleRetry();
                  }}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left',
                    'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
                    'transition-colors duration-200',
                  )}
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-error-600 dark:text-error-400" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-text-primary dark:text-text-dark-primary">
                      Update failed — retry
                    </div>
                    {errorMessage && (
                      <div className="mt-0.5 truncate text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                        {errorMessage}
                      </div>
                    )}
                  </div>
                </Button>
              )}
            </div>
          )}

          <div className="p-1.5">
            <Button
              variant="unstyled"
              onClick={() => useUIStore.getState().toggleTheme()}
              className={MENU_ITEM_CLASS}
            >
              <ThemeIcon className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="flex-1 text-xs">Theme</span>
              <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                {themeMeta.label}
              </span>
            </Button>
            <Button
              variant="unstyled"
              onClick={() => {
                setIsOpen(false);
                onOpenSettings();
              }}
              className={MENU_ITEM_CLASS}
            >
              <Settings className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="text-xs">Settings</span>
            </Button>
            <Button
              variant="unstyled"
              onClick={() => {
                setIsOpen(false);
                onSignOut();
              }}
              className={MENU_ITEM_CLASS}
            >
              <LogOut className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="text-xs">Sign out</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
