import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { ListLoadState } from '@/hooks/queries/listLoad';
import styles from './LoadErrorState.module.scss';

interface LoadErrorStateProps {
  icon: LucideIcon;
  message: string;
  load: ListLoadState;
}

export function LoadErrorState({ icon: Icon, message, load }: LoadErrorStateProps) {
  return (
    <div className={styles['load-error']} role="alert">
      <Icon className={styles.icon} />
      <p className={styles.text}>{message}</p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={load.isRetrying}
        onClick={() => void load.retry()}
      >
        {load.isRetrying ? 'Retrying…' : 'Try again'}
      </Button>
    </div>
  );
}
