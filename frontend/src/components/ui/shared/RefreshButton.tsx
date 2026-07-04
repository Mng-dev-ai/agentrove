import { RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { cn } from '@/utils/cn';

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
        className={cn(
          'rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary',
          (disabled || isRefreshing) && 'disabled:cursor-wait disabled:opacity-50',
          className,
        )}
        aria-label={ariaLabel}
      >
        {useLoader && isRefreshing ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className={cn('h-3 w-3', isRefreshing && 'animate-spin')} />
        )}
      </Button>
    </FloatingTooltip>
  );
}
