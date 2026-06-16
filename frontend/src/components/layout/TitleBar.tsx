import { useCallback } from 'react';
import { Command } from 'lucide-react';
import { useMatch } from 'react-router-dom';
import { isTauri } from '@tauri-apps/api/core';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { Button } from '@/components/ui/primitives/Button';
import { ToggleButton } from '@/components/ui/ToggleButton';
import { ViewSwitcher } from './ViewSwitcher';
import { cn } from '@/utils/cn';
import { IS_MAC_PLATFORM } from '@/utils/platform';

async function getTauriWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

// The native title bar is only hidden on macOS — traffic lights and custom drag region are macOS-only
const IS_MACOS_DESKTOP = isTauri() && IS_MAC_PLATFORM;

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
      className="z-50 flex h-10 flex-shrink-0 select-none items-center"
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      {/* Sidebar-width section — matches sidebar background */}
      <div
        className={cn(
          'flex h-full items-center gap-1 bg-surface-secondary dark:bg-surface-dark-secondary',
          'transition-[width,padding] duration-[var(--sidebar-transition-duration,500ms)] ease-in-out',
          isAuthenticated && showSidebar && sidebarOpen
            ? 'w-[var(--sidebar-width)] border-r border-border/50 dark:border-border-dark/50'
            : 'w-auto',
        )}
      >
        {IS_MACOS_DESKTOP && <TrafficLights />}

        {isAuthenticated && showSidebar && (
          <div className="ml-3 flex items-center gap-0.5">
            <ToggleButton
              isOpen={sidebarOpen}
              onClick={() => useUIStore.getState().setSidebarOpen(!sidebarOpen)}
              position="left"
              ariaLabel="Toggle sidebar"
            />
            {isChatPage && (
              <Button
                onClick={() => useUIStore.getState().setCommandMenuOpen(true)}
                variant="unstyled"
                className={cn(
                  'rounded-full p-1.5',
                  'text-text-tertiary hover:text-text-primary',
                  'dark:text-text-dark-quaternary dark:hover:text-text-dark-primary',
                  'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
                  'transition-colors duration-200',
                )}
                aria-label="Open command menu"
              >
                <Command className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        )}

        {/* Spacing after traffic lights when no sidebar controls are shown */}
        {IS_MACOS_DESKTOP && !(isAuthenticated && showSidebar) && <div className="w-1" />}
      </div>

      {/* Main content area — matches main bg */}
      <div className="flex flex-1 items-center justify-end bg-surface px-3 dark:bg-surface-dark">
        {isChatPage && <ViewSwitcher />}
      </div>
    </div>
  );
}
