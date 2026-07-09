import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { UserProfileMenu } from '@/components/layout/UserProfileMenu/UserProfileMenu';
import { SETTINGS_NAV, type TabKey } from './settingsNavItems';
import styles from './SettingsSidebarNav.module.scss';

interface SettingsSidebarNavProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  onBack: () => void;
  userDisplayName: string;
  onOpenSettings: () => void;
  onSignOut: () => void;
}

// Vertical settings navigation — desktop
export function SettingsSidebarNav({
  activeTab,
  onTabChange,
  onBack,
  userDisplayName,
  onOpenSettings,
  onSignOut,
}: SettingsSidebarNavProps) {
  return (
    <nav className={styles.nav} aria-label="Settings sections">
      <div className={styles.header}>
        <Button onClick={onBack} variant="unstyled" className={styles.back}>
          <ChevronLeft className={styles['back-icon']} />
          Back
        </Button>
        <h1 className={styles.title}>Settings</h1>
      </div>

      <div className={styles.list}>
        {SETTINGS_NAV.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <Button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              variant="unstyled"
              className={styles.item}
              role="tab"
              aria-selected={isActive}
              aria-controls={`${item.id}-panel`}
              id={`${item.id}-tab`}
            >
              <Icon className={styles['item-icon']} />
              {item.label}
            </Button>
          );
        })}
      </div>

      <div className={styles.footer}>
        <UserProfileMenu
          displayName={userDisplayName}
          onOpenSettings={onOpenSettings}
          onSignOut={onSignOut}
        />
      </div>
    </nav>
  );
}
