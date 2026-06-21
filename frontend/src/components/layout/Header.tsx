import { ArrowLeft, LogOut } from 'lucide-react';
import { useNavigate, useMatch } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { useLogoutMutation } from '@/hooks/queries/useAuthQueries';
import { Button } from '@/components/ui/primitives/Button';
import { THEME_CYCLE, getThemeMeta } from '@/utils/theme';
import type { Theme } from '@/types/ui.types';
import { cn } from '@/utils/cn';

export interface HeaderProps {
  isAuthPage?: boolean;
}

function ThemeToggleButton({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  // Show the current theme's icon (matches the profile menu); the title names what's next.
  const Icon = getThemeMeta(theme).icon;
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
  return (
    <Button
      onClick={onToggle}
      variant="unstyled"
      className={cn(
        'relative rounded-full p-1.5',
        'text-text-tertiary hover:text-text-primary',
        'dark:text-text-dark-quaternary dark:hover:text-text-dark-primary',
        'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
        'transition-colors duration-200',
      )}
      aria-label="Toggle theme"
      title={`Switch to ${getThemeMeta(next).label}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}

function AuthButtons({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={onLogin}
        variant="unstyled"
        className={cn(
          'rounded-lg px-3 py-1.5 text-xs font-medium',
          'text-text-secondary hover:text-text-primary',
          'dark:text-text-dark-secondary dark:hover:text-text-dark-primary',
          'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
          'transition-colors duration-200',
        )}
      >
        Log in
      </Button>
      <Button
        onClick={onSignup}
        variant="unstyled"
        className={cn(
          'rounded-lg px-3 py-1.5 text-xs font-medium',
          'bg-text-primary text-surface-secondary',
          'dark:bg-text-dark-primary dark:text-surface-dark-secondary',
          'transition-colors duration-200 hover:opacity-80',
        )}
      >
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

  const logoutMutation = useLogoutMutation({
    onSuccess: () => {
      useAuthStore.getState().setAuthenticated(false);
      navigate('/login');
    },
  });

  // Sidebar pages have controls in TitleBar + Sidebar footer — no header needed
  if (!isAuthPage && isAuthenticated && isSidebarPage) return null;

  return (
    <header className="z-50 border-b border-border/50 bg-surface px-4 pt-[env(safe-area-inset-top)] dark:border-border-dark/50 dark:bg-surface-dark">
      {/* pt carries the iOS top inset here too — TitleBar (which normally owns it) is null on these pages */}
      <div className="relative flex h-10 items-center justify-between">
        <div className="flex items-center gap-1">
          {isAuthPage && (
            <Button
              onClick={() => navigate('/')}
              variant="unstyled"
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs',
                'text-text-tertiary hover:text-text-primary',
                'dark:text-text-dark-tertiary dark:hover:text-text-dark-primary',
                'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
                'transition-colors duration-200',
              )}
              aria-label="Back to home"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Home</span>
            </Button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <ThemeToggleButton theme={theme} onToggle={() => useUIStore.getState().toggleTheme()} />
          {isAuthenticated && !isAuthPage && (
            <Button
              onClick={() => logoutMutation.mutate()}
              variant="unstyled"
              className={cn(
                'rounded-full p-1.5',
                'text-text-tertiary hover:text-text-primary',
                'dark:text-text-dark-quaternary dark:hover:text-text-dark-primary',
                'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
                'transition-colors duration-200',
              )}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          )}
          {!isAuthPage && !isAuthenticated && (
            <AuthButtons onLogin={() => navigate('/login')} onSignup={() => navigate('/signup')} />
          )}
        </div>
      </div>
    </header>
  );
}
