import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useEffect, useState, Suspense } from 'react';
import { lazyNamed } from '@/utils/lazyNamed';
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
import { PALETTES } from '@/styles/palettes';
import { checkDesktopUpdate } from '@/services/desktopUpdateService';
import { DesktopDragRegion } from '@/components/layout/TitleBar/TitleBar';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary/ErrorBoundary';
import styles from './App.module.scss';

const LandingPage = lazyNamed(() => import('@/pages/LandingPage/LandingPage'), 'LandingPage');
const ChatPage = lazyNamed(() => import('@/pages/ChatPage/ChatPage'), 'ChatPage');
const LoginPage = lazyNamed(() => import('@/pages/LoginPage/LoginPage'), 'LoginPage');
const SignupPage = lazyNamed(() => import('@/pages/SignupPage/SignupPage'), 'SignupPage');
const EmailVerificationPage = lazyNamed(
  () => import('@/pages/EmailVerificationPage/EmailVerificationPage'),
  'EmailVerificationPage',
);
const ForgotPasswordPage = lazyNamed(
  () => import('@/pages/ForgotPasswordPage/ForgotPasswordPage'),
  'ForgotPasswordPage',
);
const ResetPasswordPage = lazyNamed(
  () => import('@/pages/ResetPasswordPage/ResetPasswordPage'),
  'ResetPasswordPage',
);
const SettingsPage = lazyNamed(() => import('@/pages/SettingsPage/SettingsPage'), 'SettingsPage');

function AppContent() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hasToken = !!authService.getToken();
  const isSessionAuthenticated = isAuthenticated && hasToken;
  const { data: user, isLoading } = useCurrentUserQuery({
    enabled: hasToken,
    retry: false,
  });

  // Sync auth via effect (not render): Zustand is optimistic on first paint; correcting after
  // the user query must not set external store state during render (cascading updates).
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

// Window starts hidden (visible:false); call once the shell can talk to a backend.
function revealAppWindow() {
  getCurrentWindow()
    .show()
    .catch((error) => console.error('Failed to reveal app window:', error));
}

export default function App() {
  const resolvedTheme = useResolvedTheme();
  const theme = useUIStore((state) => state.theme);
  // Web/mobile ready immediately; desktop waits for sidecar port.
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
        // No hydrated refresh token → drop cloud UI state and origin routing IDs.
        const cloud = useCloudSettingsStore.getState();
        if (cloud.connectedEmail && !cloudAuthStorage.getRefreshToken()) {
          cloud.clearCloud();
          clearCloudOrigins();
        }
        setAuthHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    // data-palette selects CSS-var overrides; light/dark/system have no override block.
    document.documentElement.setAttribute('data-palette', theme);
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      const palette =
        theme === 'light' || theme === 'dark' || theme === 'system' ? null : PALETTES[theme];
      metaThemeColor.setAttribute(
        'content',
        palette?.surface ?? (resolvedTheme === 'dark' ? '#111111' : '#f5f5f5'),
      );
    }
  }, [resolvedTheme, theme]);

  useMountEffect(() => {
    // Mobile: backend URL is build-time (.env.mobile); no sidecar port wait.
    if (isMobileApp()) {
      setShellReady(true);
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

  // Tauri release builds disable Cmd/Ctrl+R reload by default.
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

  // Tauri doesn't open target="_blank" in the system browser by itself.
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
      <div className={styles['error-shell']}>
        <DesktopDragRegion />
        <div className={styles['error-body']}>
          <div className={styles['error-card']}>{desktopError}</div>
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
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </BrowserRouter>
  );
}
