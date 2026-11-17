import { Button } from '@/components/ui/primitives/Button/Button';
import type { ListLoadState } from '@/hooks/queries/listLoad';
import styles from './SidebarLoadError.module.scss';

interface SidebarLoadErrorProps {
  message: string;
  load: ListLoadState;
}

export function SidebarLoadError({ message, load }: SidebarLoadErrorProps) {
  return (
    <p className={styles.error} role="alert">
      {message}
      <Button
        variant="unstyled"
        type="button"
        onClick={() => void load.retry()}
        disabled={load.isRetrying}
        className={styles.retry}
      >
        {load.isRetrying ? 'Retrying…' : 'Try again'}
      </Button>
    </p>
  );
}
