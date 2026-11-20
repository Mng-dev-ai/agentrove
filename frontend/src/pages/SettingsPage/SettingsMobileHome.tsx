import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { SETTINGS_GROUPS, type TabKey } from './settingsNavItems';
import styles from './SettingsMobileHome.module.scss';

interface SettingsMobileHomeProps {
  onSelect: (tab: TabKey) => void;
}

export function SettingsMobileHome({ onSelect }: SettingsMobileHomeProps) {
  return (
    <div className={styles.home}>
      {SETTINGS_GROUPS.map((group) => (
        <section key={group.title}>
          <h2 className={styles['group-title']}>{group.title}</h2>
          <div className={styles.card}>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  variant="unstyled"
                  className={styles.row}
                >
                  <Icon className={styles['row-icon']} />
                  <span className={styles['row-label']}>{item.label}</span>
                  <ChevronRight className={styles['row-chevron']} />
                </Button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
