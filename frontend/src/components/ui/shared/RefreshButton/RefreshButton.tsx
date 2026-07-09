import clsx from 'clsx';
import { RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import styles from './RefreshButton.module.scss';

export interface RefreshButtonProps {
  onClick: () => void;
  disabled?: boolean;
  isRefreshing?: boolean;
  title?: string;
  ariaLabel?: string;
  className?: string;
  useLoader?: boolean;
}

export function RefreshButton({
  onClick,
  disabled = false,
  isRefreshing = false,
  title = 'Refresh',
  ariaLabel = 'Refresh',
  className,
  useLoader = false,
}: RefreshButtonProps) {
  return (
    <FloatingTooltip content={title} className="flex">
      <Button
        onClick={onClick}
        disabled={disabled || isRefreshing}
        variant="unstyled"
        className={clsx(styles['refresh-button'], className)}
        aria-label={ariaLabel}
      >
        {useLoader && isRefreshing ? (
          <Loader2 className={clsx(styles.icon, styles['icon--spin'])} />
        ) : (
          <RefreshCw className={clsx(styles.icon, isRefreshing && styles['icon--spin'])} />
        )}
      </Button>
    </FloatingTooltip>
  );
}
