import { ArrowLeft } from 'lucide-react';
import { useNavigate, useMatch } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { THEME_CYCLE, getThemeMeta } from '@/utils/theme';
import type { Theme } from '@/types/ui.types';
import styles from './Header.module.scss';

export interface HeaderProps {
  isAuthPage?: boolean;
}

function ThemeToggleButton({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  // Show the current theme's icon (matches the profile menu); the title names what's next.
  const Icon = getThemeMeta(theme).icon;
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
  return (
    <FloatingTooltip
      content={`Switch to ${getThemeMeta(next).label}`}
      className={styles['toggle-tooltip']}
    >
      <Button
        onClick={onToggle}
        variant="unstyled"
        className={styles['theme-toggle']}
        aria-label="Toggle theme"
      >
        <Icon className={styles.icon} />
      </Button>
    </FloatingTooltip>
  );
}

function AuthButtons({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  return (
    <div className={styles['auth-buttons']}>
      <Button onClick={onLogin} variant="unstyled" className={styles['auth-login']}>
        Log in
      </Button>
      <Button onClick={onSignup} variant="unstyled" className={styles['auth-signup']}>
        Get Started
      </Button>
    </div>
  );
}

export function Header({ isAuthPage = false }: HeaderProps) {
  const navigate = useNavigate();
  const isChatPage = useMatch('/chat/:chatId');
  const isLandingPage = useMatch('/');
  const isSettingsPage = useMatch('/settings');
  const theme = useUIStore((state) => state.theme);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  // Pages with their own nav + UserProfileMenu — no Header needed
  const isSidebarPage = isChatPage || isLandingPage || isSettingsPage;

  // Sidebar pages have controls in TitleBar + Sidebar footer — no header needed
  if (!isAuthPage && isAuthenticated && isSidebarPage) return null;

  return (
    <header className={styles.header}>
      {/* pt carries the iOS top inset here too — TitleBar (which normally owns it) is null on these pages */}
      <div className={styles.row}>
        <div className={styles.left}>
          {isAuthPage && (
            <Button
              onClick={() => navigate('/')}
              variant="unstyled"
              className={styles['back-button']}
              aria-label="Back to home"
            >
              <ArrowLeft className={styles.icon} />
              <span>Home</span>
            </Button>
          )}
        </div>

        <div className={styles.right}>
          <ThemeToggleButton theme={theme} onToggle={() => useUIStore.getState().toggleTheme()} />
          {!isAuthPage && !isAuthenticated && (
            <AuthButtons onLogin={() => navigate('/login')} onSignup={() => navigate('/signup')} />
          )}
        </div>
      </div>
    </header>
  );
}
