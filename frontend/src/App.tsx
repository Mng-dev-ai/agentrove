import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useEffect, useMemo, useState, Suspense, lazy } from 'react';
import { useMountEffect } from '@/hooks/useMountEffect';
import { Layout } from '@/components/layout/Layout';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import {
  useCurrentUserQuery,
  useDesktopLocalSessionMutation,
} from '@/hooks/queries/useAuthQueries';
import { useInfiniteChatsQuery } from '@/hooks/queries/useChatQueries';
import { LoadingScreen } from '@/components/ui/LoadingScreen';
import { useGlobalStream } from '@/hooks/useGlobalStream';
import { useStreamRestoration } from '@/hooks/useStreamRestoration';
import { authService } from '@/services/authService';
import { toasterConfig } from '@/config/toaster';
import { AuthRoute } from '@/components/routes/AuthRoute';
import { setApiPort } from '@/lib/api';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { authStorage } from '@/utils/storage';
import { checkDesktopUpdate } from '@/services/desktopUpdateService';
import { DesktopDragRegion } from '@/components/layout/TitleBar';

const LandingPage = lazy(() =>
  import('@/pages/LandingPage').then((m) => ({ default: m.LandingPage })),
);
const ChatPage = lazy(() => import('@/pages/ChatPage').then((m) => ({ default: m.ChatPage })));
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const SignupPage = lazy(() =>
  import('@/pages/SignupPage').then((m) => ({ default: m.SignupPage })),
);
const EmailVerificationPage = lazy(() =>
  import('@/pages/EmailVerificationPage').then((m) => ({ default: m.EmailVerificationPage })),
);
const ForgotPasswordPage = lazy(() =>
  import('@/pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  import('@/pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })),
);
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

function AppContent() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hasToken = !!authService.getToken();
  const isSessionAuthenticated = isAuthenticated && hasToken;
  const { data: user, isLoading } = useCurrentUserQuery({
    enabled: hasToken,
    retry: false,
  });

  // NOTE: This effect intentionally syncs auth state via useEffect rather than deriving during
  // render (rerender-derived-state-no-effect). The persisted Zustand store provides an optimistic
  // cached isAuthenticated on first load to prevent flash of unauthenticated content, then this
  // effect corrects it after the user query resolves. Moving to render-time derivation would
  // require calling an external store setter during render, which re-triggers subscribers
  // synchronously and risks cascading updates.
  useEffect(() => {
    if (hasToken && user) {
      useAuthStore.getState().setAuthenticated(true);
    } else if (isAuthenticated && !hasToken) {
      useAuthStore.getState().setAuthenticated(false);
    }
  }, [user, hasToken, isAuthenticated]);

  const { data: chatsData, isLoading: isChatsLoading } = useInfiniteChatsQuery({
    enabled: isSessionAuthenticated,
  });

  const allChats = useMemo(
    () => chatsData?.pages.flatMap((page) => page.items) ?? [],
    [chatsData?.pages],
  );

  useStreamRestoration({
    chats: allChats,
    isLoading: isChatsLoading,
    enabled: isSessionAuthenticated,
  });

  const showLoading = hasToken && isLoading;

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route
          path="/login"
          element={
            <AuthRoute isAuthenticated={isSessionAuthenticated} requireAuth={false}>
              <LoginPage />
            </AuthRoute>
          }
        />
        <Route
          path="/signup"
          element={
            <AuthRoute isAuthenticated={isSessionAuthenticated} requireAuth={false}>
              <SignupPage />
            </AuthRoute>
          }
        />
        <Route path="/verify-email" element={<EmailVerificationPage />} />
        <Route
          path="/forgot-password"
          element={
            <AuthRoute isAuthenticated={isSessionAuthenticated} requireAuth={false}>
              <ForgotPasswordPage />
            </AuthRoute>
          }
        />
        <Route
          path="/reset-password"
          element={
            <AuthRoute isAuthenticated={isSessionAuthenticated} requireAuth={false}>
              <ResetPasswordPage />
            </AuthRoute>
          }
        />
        <Route
          path="/"
          element={
            showLoading ? (
              <LoadingScreen />
            ) : (
              <Layout>
                <LandingPage />
              </Layout>
            )
          }
        />
        <Route
          path="/chat/:chatId"
          element={
            <AuthRoute
              isAuthenticated={isSessionAuthenticated}
              requireAuth={true}
              showLoading={showLoading}
            >
              <ChatPage />
            </AuthRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <AuthRoute
              isAuthenticated={isSessionAuthenticated}
              requireAuth={true}
              showLoading={showLoading}
            >
              <SettingsPage />
            </AuthRoute>
          }
        />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  const resolvedTheme = useResolvedTheme();
  const [desktopReady, setDesktopReady] = useState(!isTauri());
  const [desktopError, setDesktopError] = useState<string | null>(null);
  const [authHydrated, setAuthHydrated] = useState(false);
  const [desktopBootstrapAttempted, setDesktopBootstrapAttempted] = useState(!isTauri());
  const { mutate: startDesktopLocalSession, isPending: isDesktopBootstrapPending } =
    useDesktopLocalSessionMutation({
      onSuccess: () => {
        useAuthStore.getState().setAuthenticated(true);
      },
      onError: (error) => {
        console.error('Desktop local auth bootstrap failed:', error);
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'Desktop local session failed.';
        setDesktopError(`${message} Restart Agentrove and try again.`);
      },
    });

  useGlobalStream({ enabled: authHydrated && desktopReady && !!authStorage.getToken() });

  useMountEffect(() => {
    let cancelled = false;

    authStorage
      .hydrate()
      .catch((error) => {
        console.error('Auth storage hydration failed:', error);
      })
      .finally(() => {
        if (cancelled) return;
        useAuthStore.getState().setAuthenticated(!!authStorage.getToken());
        setAuthHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  });

  useEffect(() => {
    document.body.classList.remove('light', 'dark');
    document.body.classList.add(resolvedTheme);
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', resolvedTheme === 'dark' ? '#0a0a0a' : '#ffffff');
    }
  }, [resolvedTheme]);

  useEffect(() => {
    if (!isTauri() || !desktopReady || !authHydrated || desktopBootstrapAttempted) return;

    if (authStorage.getToken()) {
      setDesktopBootstrapAttempted(true);
      return;
    }

    setDesktopBootstrapAttempted(true);
    startDesktopLocalSession();
  }, [authHydrated, desktopBootstrapAttempted, desktopReady, startDesktopLocalSession]);

  useMountEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;

    invoke<number>('get_backend_port')
      .then((port) => {
        if (cancelled) return;
        setApiPort(port);
        setDesktopReady(true);
        getCurrentWindow()
          .show()
          .catch((error) => {
            console.error('Failed to show desktop window:', error);
          });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to resolve desktop backend port:', error);
        setDesktopError('Desktop backend failed to start. Restart Agentrove and try again.');
        getCurrentWindow()
          .show()
          .catch((error) => {
            console.error('Failed to show desktop window:', error);
          });
      });

    return () => {
      cancelled = true;
    };
  });

  useMountEffect(() => {
    if (import.meta.env.DEV || !isTauri()) return;

    checkDesktopUpdate().catch((error) => {
      console.error('Desktop updater check failed:', error);
    });
  });

  // Cmd+R / Ctrl+R reloads the webview — Tauri release builds disable this by default
  useMountEffect(() => {
    if (!isTauri()) return;

    function handler(e: KeyboardEvent) {
      const accel = e.metaKey || e.ctrlKey;
      if (!accel || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'r') return;
      e.preventDefault();
      window.location.reload();
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // Open external links in the system browser — Tauri doesn't handle target="_blank" natively
  useMountEffect(() => {
    if (!isTauri()) return;

    let openUrl: ((url: string) => Promise<void>) | null = null;
    void import('@tauri-apps/plugin-opener').then((m) => {
      openUrl = m.openUrl;
    });

    function handler(e: MouseEvent) {
      if (!openUrl || !(e.target instanceof Element)) return;
      const anchor = e.target.closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href || !(href.startsWith('http://') || href.startsWith('https://'))) return;

      e.preventDefault();
      void openUrl(href);
    }

    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  });

  if (desktopError) {
    return (
      <div className="bg-surface-primary dark:bg-surface-dark-primary flex min-h-screen flex-col text-text-primary dark:text-text-dark-primary">
        <DesktopDragRegion />
        <div className="flex flex-1 items-center justify-center">
          <div className="rounded-lg border border-border/50 bg-surface-secondary px-4 py-3 text-xs dark:border-border-dark/50 dark:bg-surface-dark-secondary">
            {desktopError}
          </div>
        </div>
      </div>
    );
  }

  if (!desktopReady || !authHydrated || isDesktopBootstrapPending) {
    return <LoadingScreen />;
  }

  return (
    <BrowserRouter>
      <Toaster {...toasterConfig} />
      <AppContent />
    </BrowserRouter>
  );
}
