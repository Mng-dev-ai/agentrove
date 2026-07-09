import { useCallback } from 'react';
import { useMatch } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { Button } from '@/components/ui/primitives/Button';
import { ToggleButton } from '@/components/ui/ToggleButton';
import { ViewSwitcher, type SwitchableView } from './ViewSwitcher';
import { ChatTabs } from './ChatTabs';
import { cn } from '@/utils/cn';
import { IS_MAC_PLATFORM, isDesktopApp } from '@/utils/platform';

// The landing page's renderView only supports these two non-agent views —
// diff/terminal need a chat, so their switcher buttons would open blank panes.
const LANDING_VIEWS: SwitchableView[] = ['editor', 'secrets'];

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
    <div className="flex items-center gap-2 pl-3">
      <Button
        type="button"
        variant="unstyled"
        onClick={handleClose}
        className="group flex h-3 w-3 items-center justify-center rounded-full bg-traffic-close transition-opacity hover:opacity-90"
        aria-label="Close window"
      >
        <svg
          width="6"
          height="6"
          viewBox="0 0 6 6"
          className="text-black/60 opacity-0 group-hover:opacity-100"
        >
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
        className="group flex h-3 w-3 items-center justify-center rounded-full bg-traffic-minimize transition-opacity hover:opacity-90"
        aria-label="Minimize window"
      >
        <svg
          width="6"
          height="2"
          viewBox="0 0 6 2"
          className="text-black/60 opacity-0 group-hover:opacity-100"
        >
          <path d="M0.5 1H5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </Button>
      <Button
        type="button"
        variant="unstyled"
        onClick={handleMaximize}
        className="group flex h-3 w-3 items-center justify-center rounded-full bg-traffic-maximize transition-opacity hover:opacity-90"
        aria-label="Maximize window"
      >
        <svg
          width="6"
          height="6"
          viewBox="0 0 6 6"
          className="text-black/60 opacity-0 group-hover:opacity-100"
        >
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
      className="z-50 flex h-10 flex-shrink-0 select-none items-center"
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      <TrafficLights />
      <div className="flex-1" />
    </div>
  );
}

export function TitleBar() {
  const isChatPage = useMatch('/chat/:chatId');
  const isLandingPage = useMatch('/');
  const showSidebar = isChatPage || isLandingPage;
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);

  const hasContent = IS_MACOS_DESKTOP || (isAuthenticated && showSidebar);
  // Don't render an empty bar when there are no controls to show
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
      className="z-50 flex h-[calc(2.5rem+env(safe-area-inset-top))] flex-shrink-0 select-none"
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      {/* Left section — same secondary surface as the main band. While the sidebar is
          open it doubles as the sidebar's header strip (border-r, no hairline below so
          it merges into the sidebar); when closed the band's hairline runs to the edge. */}
      <div
        className={cn(
          'flex h-full items-center gap-1 bg-surface-secondary pt-[env(safe-area-inset-top)] dark:bg-surface-dark-secondary',
          'transition-[width,padding] duration-[var(--sidebar-transition-duration,500ms)] ease-in-out',
          isAuthenticated && showSidebar && sidebarOpen
            ? 'w-[var(--sidebar-width)] border-r border-border/50 dark:border-border-dark/50'
            : 'w-auto border-b border-border/50 dark:border-border-dark/50',
        )}
      >
        {IS_MACOS_DESKTOP && <TrafficLights />}

        {isAuthenticated && showSidebar && (
          <div className="ml-3 flex items-center">
            <ToggleButton
              isOpen={sidebarOpen}
              onClick={() => useUIStore.getState().setSidebarOpen(!sidebarOpen)}
              position="left"
              ariaLabel="Toggle sidebar"
            />
          </div>
        )}

        {/* Spacing after traffic lights when no sidebar controls are shown */}
        {IS_MACOS_DESKTOP && !(isAuthenticated && showSidebar) && <div className="w-1" />}
      </div>

      {/* Main content area — a secondary-surface band with a hairline below, which
          the active chat tab's underline indicator crosses. Chat tabs (the open
          working set) sit on the left; the view switcher stays pinned right. */}
      <div className="flex h-full min-w-0 flex-1 items-center justify-between gap-2 border-b border-border/50 bg-surface-secondary px-3 pt-[env(safe-area-inset-top)] dark:border-border-dark/50 dark:bg-surface-dark-secondary">
        <div className="flex h-full min-w-0 flex-1 items-end gap-1">
          {/* Auth gate: on macOS desktop the bar renders even when logged out, and
              persisted chatTabs would fire protected chat queries (and self-close
              on the resulting 401s, wiping the working set). */}
          {isAuthenticated && (isChatPage || isLandingPage) && <ChatTabs />}
        </div>
        {/* Views have no tabs — the switcher is the only affordance to open and
            close them, so landing (which can show an editor/secrets pane) needs
            it too, just restricted to the views it can render. */}
        {isChatPage && <ViewSwitcher />}
        {isLandingPage && <ViewSwitcher views={LANDING_VIEWS} />}
      </div>
    </div>
  );
}
