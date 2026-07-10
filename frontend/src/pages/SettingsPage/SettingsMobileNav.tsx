import clsx from 'clsx';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { SETTINGS_NAV, TAB_LABELS, type TabKey } from './settingsNavItems';
import styles from './SettingsMobileNav.module.scss';

interface SettingsMobileNavProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  onBack: () => void;
  mobileNavOpen: boolean;
  onToggleNav: () => void;
}

// Mobile top bar + dropdown for settings nav
export function SettingsMobileNav({
  activeTab,
  onTabChange,
  onBack,
  mobileNavOpen,
  onToggleNav,
}: SettingsMobileNavProps) {
  return (
    <>
      {/* pt folds in the iOS top inset (no TitleBar on settings) — env() is 0 on web, so pt stays 0.625rem there */}
      <div className={styles.bar}>
        <Button
          onClick={onBack}
          variant="unstyled"
          className={styles['bar-back']}
          aria-label="Go back"
        >
          <ChevronLeft className={styles['bar-back-icon']} />
        </Button>
        <Button
          onClick={onToggleNav}
          variant="unstyled"
          className={styles['bar-toggle']}
          aria-label="Toggle navigation menu"
          aria-expanded={mobileNavOpen}
        >
          {TAB_LABELS[activeTab]}
          <svg
            className={clsx(styles['bar-chevron'], mobileNavOpen && styles['bar-chevron--open'])}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </Button>
      </div>

      {mobileNavOpen && (
        <div className={styles.dropdown}>
          {SETTINGS_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <Button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                variant="unstyled"
                className={clsx(styles.item, isActive && styles['item--active'])}
              >
                <Icon className={styles['item-icon']} />
                {item.label}
              </Button>
            );
          })}
        </div>
      )}
    </>
  );
}
