import { Switch } from '@/components/ui/primitives/Switch/Switch';
import styles from './SettingsCard.module.scss';

export function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className={styles['section-title']}>{title}</h2>
      <div className={styles['section-card']}>{children}</div>
    </section>
  );
}

interface ToggleRowProps {
  title: string;
  desc: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  ariaLabel: string;
}

export function ToggleRow({ title, desc, checked, onCheckedChange, ariaLabel }: ToggleRowProps) {
  return (
    <div className={styles['toggle-row']}>
      <div className={styles['toggle-text']}>
        <h3 className={styles['toggle-title']}>{title}</h3>
        <p className={styles['toggle-desc']}>{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={ariaLabel} />
    </div>
  );
}
