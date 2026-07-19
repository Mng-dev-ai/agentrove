import { useCallback } from 'react';
import { Plus, Search } from 'lucide-react';
import { useMatch, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { Button } from '@/components/ui/primitives/Button/Button';
import { ToggleButton } from '@/components/ui/ToggleButton/ToggleButton';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { ViewSwitcher } from '@/components/layout/ViewSwitcher/ViewSwitcher';
import { ChatTabs } from '@/components/layout/ChatTabs/ChatTabs';
import clsx from 'clsx';
import { IS_MAC_PLATFORM, isDesktopApp } from '@/utils/platform';
import styles from './TitleBar.module.scss';

async function getTauriWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

// The native title bar is only hidden on macOS — traffic lights and custom drag region are macOS-only
const IS_MACOS_DESKTOP = isDesktopApp() && IS_MAC_PLATFORM;

export function TrafficLights() {
  const handleClose = useCallback(async () => {
    await (await getTauriWindow()).close();
  }, []);

  const handleMinimize = useCallback(async () => {
    await (await getTauriWindow()).minimize();
  }, []);

  const handleMaximize = useCallback(async () => {
    await (await getTauriWindow()).toggleMaximize();
  }, []);

  return (
    <div className={styles['traffic-lights']}>
      <Button
        type="button"
        variant="unstyled"
        onClick={handleClose}
        className={clsx(styles['traffic-light'], styles['traffic-light--close'])}
        aria-label="Close window"
      >
        <svg width="6" height="6" viewBox="0 0 6 6" className={styles['traffic-glyph']}>
          <path
            d="M0.5 0.5L5.5 5.5M5.5 0.5L0.5 5.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </Button>
      <Button
        type="button"
        variant="unstyled"
        onClick={handleMinimize}
        className={clsx(styles['traffic-light'], styles['traffic-light--minimize'])}
        aria-label="Minimize window"
      >
        <svg width="6" height="2" viewBox="0 0 6 2" className={styles['traffic-glyph']}>
          <path d="M0.5 1H5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </Button>
      <Button
        type="button"
        variant="unstyled"
        onClick={handleMaximize}
        className={clsx(styles['traffic-light'], styles['traffic-light--maximize'])}
        aria-label="Maximize window"
      >
        <svg width="6" height="6" viewBox="0 0 6 6" className={styles['traffic-glyph']}>
          <path
            d="M1 2L3 0.5L5 2M1 4L3 5.5L5 4"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Button>
    </div>
  );
}

// Minimal drag region with traffic lights for screens rendered outside Layout (error, loading).
// Does not depend on react-router or auth state.
export function DesktopDragRegion() {
  if (!IS_MACOS_DESKTOP) return null;

  const handleMouseDown = async (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    await (await getTauriWindow()).startDragging();
  };

  const handleDoubleClick = async () => {
    await (await getTauriWindow()).toggleMaximize();
  };

  return (
    <div
      className={styles['drag-region']}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      <TrafficLights />
      <div className={styles['drag-spacer']} />
    </div>
  );
}

export function TitleBar() {
  const navigate = useNavigate();
  const isChatPage = useMatch('/chat/:chatId');
  const isLandingPage = useMatch('/');
  const showSidebar = isChatPage || isLandingPage;
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);

  const hasContent = IS_MACOS_DESKTOP || (isAuthenticated && showSidebar);
  if (!hasContent) return null;

  // Uses native startDragging API — data-tauri-drag-region doesn't work on frameless windows in Tauri v2
  const handleMouseDown = async (e: React.MouseEvent) => {
    if (!IS_MACOS_DESKTOP) return;
    // Only drag from the bar itself, not from interactive children
    if ((e.target as HTMLElement).closest('button')) return;
    await (await getTauriWindow()).startDragging();
  };

  const handleDoubleClick = async () => {
    if (!IS_MACOS_DESKTOP) return;
    await (await getTauriWindow()).toggleMaximize();
  };

  return (
    <div
      // The row owns the height (2.5rem bar + top inset); each section pads its
      // content below the inset (pt) so the section's background bleeds under the
      // iOS status bar. env() is 0 on desktop/web, so the bar stays a plain h-10.
      className={styles['title-bar']}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      {/* When docked, merges into the sidebar header (border-r, no hairline). */}
      <div
        className={clsx(
          styles.left,
          isAuthenticated && showSidebar && sidebarOpen && styles['left--docked'],
        )}
      >
        {IS_MACOS_DESKTOP && <TrafficLights />}

        {isAuthenticated && showSidebar && (
          <div className={styles['toggle-wrap']}>
            <ToggleButton
              isOpen={sidebarOpen}
              onClick={() => useUIStore.getState().setSidebarOpen(!sidebarOpen)}
              position="left"
              ariaLabel="Toggle sidebar"
            />
            {/* Search/new chat only when sidebar is closed (it already has both). */}
            {!sidebarOpen && (
              <>
                <FloatingTooltip content="Search">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={styles['icon-button']}
                    onClick={() => useUIStore.getState().setCommandMenuOpen(true)}
                    aria-label="Search"
                  >
                    <Search className={styles['icon-button-glyph']} />
                  </Button>
                </FloatingTooltip>
                <FloatingTooltip content="New chat">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={styles['icon-button']}
                    onClick={() => navigate('/')}
                    aria-label="New chat"
                  >
                    <Plus className={styles['icon-button-glyph']} />
                  </Button>
                </FloatingTooltip>
              </>
            )}
          </div>
        )}

        {/* Spacer after traffic lights when sidebar controls are absent. */}
        {IS_MACOS_DESKTOP && !(isAuthenticated && showSidebar) && <div className={styles.spacer} />}
      </div>

      <div className={styles.band}>
        <div className={styles['tabs-area']}>
          {/* Auth gate: macOS desktop still renders the bar logged out; without this,
              persisted chatTabs would hit protected queries and 401-self-close. */}
          {isAuthenticated && (isChatPage || isLandingPage) && <ChatTabs />}
        </div>
        {/* No per-view tabs — switcher opens/closes views (landing needs it too). */}
        {(isChatPage || isLandingPage) && <ViewSwitcher />}
      </div>
    </div>
  );
}
