import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './SidebarLoadError.module.scss';

interface SidebarLoadErrorProps {
  message: string;
  isRetrying: boolean;
  onRetry: () => void;
}

export function SidebarLoadError({ message, isRetrying, onRetry }: SidebarLoadErrorProps) {
  return (
    <p className={styles.error} role="alert">
      {message}
      <Button
        variant="unstyled"
        type="button"
        onClick={onRetry}
        disabled={isRetrying}
        className={styles.retry}
      >
        {isRetrying ? 'Retrying…' : 'Try again'}
      </Button>
    </p>
  );
}
