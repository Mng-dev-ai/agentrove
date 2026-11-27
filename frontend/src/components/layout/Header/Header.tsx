import { useUIStore } from '@/store/uiStore';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { THEME_CYCLE, getThemeMeta } from '@/utils/theme';
import type { Theme } from '@/types/ui.types';
import styles from './Header.module.scss';

function ThemeToggleButton({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  // Icon is the current theme (matches profile menu); tooltip names the next.
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

// Only the auth pages show this header: every signed-in page has a TitleBar and sidebar.
export function Header() {
  const theme = useUIStore((state) => state.theme);

  return (
    <header className={styles.header}>
      {/* pt carries the iOS top inset here too — TitleBar (which normally owns it) is null on these pages */}
      <div className={styles.row}>
        <div className={styles.right}>
          <ThemeToggleButton theme={theme} onToggle={() => useUIStore.getState().toggleTheme()} />
        </div>
      </div>
    </header>
  );
}
