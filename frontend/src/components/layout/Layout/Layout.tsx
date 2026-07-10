import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Header, type HeaderProps } from '@/components/layout/Header/Header';
import { TitleBar } from '@/components/layout/TitleBar/TitleBar';
import { Link } from '@/components/ui/primitives/Link/Link';
import { LayoutContext, type LayoutContextValue } from './layoutState';
import { useUIStore } from '@/store/uiStore';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import { useIsMobile } from '@/hooks/useIsMobile';
import styles from './Layout.module.scss';

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
      className={styles.overlay}
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
      <div className={clsx(styles.layout, className)}>
        <Link
          href="#main-content"
          variant="unstyled"
          className={clsx('sr-only', styles['skip-link'])}
        >
          Skip to main content
        </Link>
        <TitleBar />
        {showHeader && <Header isAuthPage={isAuthPage} />}

        <div className={styles.body}>
          {sidebarContent && <MobileSidebarOverlay />}

          {sidebarContent ? <div className={styles['sidebar-slot']}>{sidebarContent}</div> : null}

          <main
            id="main-content"
            className={clsx(
              styles.main,
              shouldPushContent && styles['main--pushed'],
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
