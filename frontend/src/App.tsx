import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useEffect, useState, Suspense, lazy } from 'react';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useDesktopZoom } from '@/hooks/useDesktopZoom';
import { Layout } from '@/components/layout/Layout/Layout';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import { useUIStore } from '@/store/uiStore';
import { useCurrentUserQuery } from '@/hooks/queries/useAuthQueries';
import { LoadingScreen } from '@/components/ui/LoadingScreen/LoadingScreen';
import { useGlobalStream } from '@/hooks/useGlobalStream';
import { useLocalStreamRestoration } from '@/hooks/useLocalStreamRestoration';
import { useCloudStreamRestoration } from '@/hooks/useCloudStreamRestoration';
import { useChatEvents } from '@/hooks/useChatEvents';
import { useCloudChatEvents } from '@/hooks/useCloudChatEvents';
import { authService } from '@/services/authService';
import { toasterConfig } from '@/config/toaster';
import { AuthRoute } from '@/components/routes/AuthRoute/AuthRoute';
import { setApiPort } from '@/lib/api';
import { isTauri, invoke } from '@tauri-apps/api/core';
import { isDesktopApp, isMobileApp } from '@/utils/platform';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { authStorage, cloudAuthStorage } from '@/utils/storage';
import { clearCloudOrigins } from '@/utils/chatOrigin';
import { checkDesktopUpdate } from '@/services/desktopUpdateService';
import { DesktopDragRegion } from '@/components/layout/TitleBar/TitleBar';

const LandingPage = lazy(() =>
  import('@/pages/LandingPage').then((m) => ({ default: m.LandingPage })),
);
const ChatPage = lazy(() => import('@/pages/ChatPage').then((m) => ({ default: m.ChatPage })));
const LoginPage = lazy(() =>
  import('@/pages/LoginPage/LoginPage').then((m) => ({ default: m.LoginPage })),
);
const SignupPage = lazy(() =>
  import('@/pages/SignupPage/SignupPage').then((m) => ({ default: m.SignupPage })),
);
const EmailVerificationPage = lazy(() =>
  import('@/pages/EmailVerificationPage/EmailVerificationPage').then((m) => ({
    default: m.EmailVerificationPage,
  })),
);
const ForgotPasswordPage = lazy(() =>
  import('@/pages/ForgotPasswordPage/ForgotPasswordPage').then((m) => ({
    default: m.ForgotPasswordPage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import('@/pages/ResetPasswordPage/ResetPasswordPage').then((m) => ({
    default: m.ResetPasswordPage,
  })),
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

  useLocalStreamRestoration({ enabled: isSessionAuthenticated });
  useCloudStreamRestoration({ enabled: isSessionAuthenticated });
  useChatEvents({ enabled: isSessionAuthenticated });
  useCloudChatEvents({ enabled: isSessionAuthenticated });

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

// The window starts hidden (visible:false) on every shell — reveal it once the shell is ready.
function revealAppWindow() {
  getCurrentWindow()
    .show()
    .catch((error) => console.error('Failed to reveal app window:', error));
}

export default function App() {
  const resolvedTheme = useResolvedTheme();
  const theme = useUIStore((state) => state.theme);
  // Ready = the shell can talk to a backend: web/mobile immediately, desktop after the sidecar port resolves
  const [shellReady, setShellReady] = useState(!isTauri());
  const [desktopError, setDesktopError] = useState<string | null>(null);
  const [authHydrated, setAuthHydrated] = useState(false);

  useGlobalStream({ enabled: authHydrated && shellReady });

  useMountEffect(() => {
    let cancelled = false;

    Promise.all([authStorage.hydrate(), cloudAuthStorage.hydrate()])
      .catch((error) => {
        console.error('Auth storage hydration failed:', error);
      })
      .finally(() => {
        if (cancelled) return;
        useAuthStore.getState().setAuthenticated(!!authStorage.getToken());
        // Drop the cloud connection if its refresh token didn't hydrate —
        // otherwise the UI shows a connected state we can't use.
        const cloud = useCloudSettingsStore.getState();
        if (cloud.connectedEmail && !cloudAuthStorage.getRefreshToken()) {
          cloud.clearCloud();
          // Drop persisted cloud origin IDs too — otherwise stale IDs keep routing
          // through remoteApiClient after the UI shows cloud as disconnected.
          clearCloudOrigins();
        }
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
    // data-palette drives the per-theme CSS-var overrides (dim/sepia); base modes have no override block
    document.documentElement.setAttribute('data-palette', theme);
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', resolvedTheme === 'dark' ? '#0a0a0a' : '#ffffff');
    }
  }, [resolvedTheme, theme]);

  useMountEffect(() => {
    // Mobile has no local sidecar — the backend URL is baked in at build time
    // (.env.mobile), so just mark ready and skip the desktop backend startup.
    if (isMobileApp()) {
      setShellReady(true);
      // Mobile has no backend-port step to trigger the reveal — show it directly.
      revealAppWindow();
      return;
    }

    if (!isDesktopApp()) return;

    let cancelled = false;

    invoke<number>('get_backend_port')
      .then((port) => {
        if (cancelled) return;
        setApiPort(port);
        setShellReady(true);
        revealAppWindow();
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to resolve desktop backend port:', error);
        setDesktopError('Desktop backend failed to start. Restart Agentrove and try again.');
        revealAppWindow();
      });

    return () => {
      cancelled = true;
    };
  });

  useMountEffect(() => {
    if (import.meta.env.DEV || !isDesktopApp()) return;

    checkDesktopUpdate().catch((error) => {
      console.error('Desktop updater check failed:', error);
    });
  });

  useDesktopZoom();

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
      <div className="flex min-h-screen flex-col bg-surface text-text-primary dark:bg-surface-dark dark:text-text-dark-primary">
        <DesktopDragRegion />
        <div className="flex flex-1 items-center justify-center">
          <div className="rounded-lg border border-border/50 bg-surface-secondary px-4 py-3 text-xs dark:border-border-dark/50 dark:bg-surface-dark-secondary">
            {desktopError}
          </div>
        </div>
      </div>
    );
  }

  if (!shellReady || !authHydrated) {
    return <LoadingScreen />;
  }

  return (
    <BrowserRouter>
      <Toaster {...toasterConfig} />
      <AppContent />
    </BrowserRouter>
  );
}
