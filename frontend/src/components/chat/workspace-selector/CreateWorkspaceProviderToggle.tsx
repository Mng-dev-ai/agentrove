import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './CreateWorkspaceProviderToggle.module.scss';

// Sandbox provider picker shared by the empty-workspace and git-clone creation forms.
export function CreateWorkspaceProviderToggle({
  value,
  onChange,
}: {
  value: 'docker' | 'host';
  onChange: (v: 'docker' | 'host') => void;
}) {
  return (
    <div className={styles['provider-toggle']}>
      <span className={styles.label}>Provider:</span>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onChange('host')}
        className={clsx(styles.option, value === 'host' && styles['option--active'])}
      >
        Host
      </Button>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onChange('docker')}
        className={clsx(styles.option, value === 'docker' && styles['option--active'])}
      >
        Docker
      </Button>
    </div>
  );
}
