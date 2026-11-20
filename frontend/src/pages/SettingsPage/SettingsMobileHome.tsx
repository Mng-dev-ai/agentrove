import { ChevronRight } from 'lucide-react';
import { SectionCard } from '@/components/settings/SettingsCard/SettingsCard';
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
        <SectionCard key={group.title} title={group.title}>
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
        </SectionCard>
      ))}
    </div>
  );
}
