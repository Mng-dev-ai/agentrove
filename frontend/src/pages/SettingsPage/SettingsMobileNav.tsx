import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './SettingsMobileNav.module.scss';

interface SettingsMobileNavProps {
  title: string;
  backLabel?: string;
  onBack: () => void;
}

export function SettingsMobileNav({ title, backLabel, onBack }: SettingsMobileNavProps) {
  return (
    // bar CSS folds in safe-area-inset-top (0 on web; no TitleBar on settings).
    <div className={styles.bar}>
      <Button
        onClick={onBack}
        variant="unstyled"
        className={styles['bar-back']}
        aria-label={backLabel ?? 'Go back'}
      >
        <ChevronLeft className={styles['bar-back-icon']} />
        {backLabel}
      </Button>
      <h1 className={styles['bar-title']}>{title}</h1>
    </div>
  );
}
