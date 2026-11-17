import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { ListLoadState } from '@/hooks/queries/listLoad';
import styles from './LoadErrorState.module.scss';

type LoadErrorStateProps = { message: string; load: ListLoadState } & (
  | { variant: 'inline' }
  | { icon: LucideIcon }
);

export function LoadErrorState(props: LoadErrorStateProps) {
  const { message, load } = props;
  const retryLabel = load.isRetrying ? 'Retrying…' : 'Try again';

  if (!('icon' in props)) {
    return (
      <p className={styles.inline} role="alert">
        {message}
        <Button
          variant="unstyled"
          type="button"
          onClick={() => void load.retry()}
          disabled={load.isRetrying}
          className={styles['inline-retry']}
        >
          {retryLabel}
        </Button>
      </p>
    );
  }

  const Icon = props.icon;
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
        {retryLabel}
      </Button>
    </div>
  );
}
