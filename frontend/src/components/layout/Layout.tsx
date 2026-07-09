import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Header, type HeaderProps } from './Header';
import { TitleBar } from './TitleBar';
import { Link } from '@/components/ui/primitives/Link/Link';
import { cn } from '@/utils/cn';
import { LayoutContext, type LayoutContextValue } from './layoutState';
import { useUIStore } from '@/store/uiStore';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import { useIsMobile } from '@/hooks/useIsMobile';

function useSidebarWidthVar() {
  useEffect(() => {
    const apply = (width: number) => {
      document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
    };
    apply(useUIStore.getState().sidebarWidth);
    return useUIStore.subscribe((state, prev) => {
      if (state.sidebarWidth !== prev.sidebarWidth) apply(state.sidebarWidth);
    });
  }, []);
}

function MobileSidebarOverlay() {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);

  if (!sidebarOpen) return null;

  return (
    <div
      className="fixed inset-0 z-30 bg-black/50 md:hidden"
      onClick={() => useUIStore.getState().setSidebarOpen(false)}
      aria-hidden="true"
    />
  );
}

export interface LayoutProps extends HeaderProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  showHeader?: boolean;
}

export function Layout({
  children,
  isAuthPage = false,
  className,
  contentClassName,
  showHeader = true,
}: LayoutProps) {
  const [sidebarContent, setSidebarContent] = useState<ReactNode | null>(null);
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const isMobile = useIsMobile();
  const shouldPushContent = !!sidebarContent && sidebarOpen && !isMobile;

  useSidebarWidthVar();

  useSwipeGesture({
    onSwipeRight: () => useUIStore.getState().setSidebarOpen(true),
    onSwipeLeft: () => sidebarOpen && useUIStore.getState().setSidebarOpen(false),
    enabled: isMobile && !!sidebarContent,
  });

  const setSidebar = useCallback((content: ReactNode | null) => {
    setSidebarContent(content);
  }, []);

  const contextValue = useMemo<LayoutContextValue>(
    () => ({
      sidebar: sidebarContent,
      setSidebar,
    }),
    [setSidebar, sidebarContent],
  );

  return (
    <LayoutContext.Provider value={contextValue}>
      <div className={cn('h-viewport flex flex-col', className)}>
        <Link
          href="#main-content"
          variant="unstyled"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[300] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:text-text-primary focus:shadow-strong dark:focus:bg-surface-dark dark:focus:text-text-dark-primary"
        >
          Skip to main content
        </Link>
        <TitleBar />
        {showHeader && <Header isAuthPage={isAuthPage} />}

        <div className="flex min-h-0 flex-1">
          {sidebarContent && <MobileSidebarOverlay />}

          {sidebarContent ? (
            <div className="relative h-full flex-shrink-0">{sidebarContent}</div>
          ) : null}

          <main
            id="main-content"
            className={cn(
              'relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-surface transition-[padding] duration-[var(--sidebar-transition-duration,500ms)] ease-in-out dark:bg-surface-dark',
              shouldPushContent ? 'pl-[var(--sidebar-width)]' : 'pl-0',
              contentClassName,
            )}
          >
            {children}
          </main>
        </div>
      </div>
    </LayoutContext.Provider>
  );
}
