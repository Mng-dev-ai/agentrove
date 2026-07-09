import { ArrowUp, LoaderCircle, Pause } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';

export type SendButtonStatus = 'idle' | 'ready' | 'loading' | 'streaming';

export interface SendButtonProps {
  status: SendButtonStatus;
  disabled: boolean;
  onClick: (e: React.MouseEvent) => void;
  type?: 'button' | 'submit';
  className?: string;
  showLoadingSpinner?: boolean;
}

const BASE_CLASSES =
  'p-1.5 rounded-full transition-colors duration-200 transform disabled:opacity-50 disabled:cursor-not-allowed active:scale-95';

const PRIMARY_BG =
  'bg-text-primary dark:bg-text-dark-primary hover:bg-text-secondary dark:hover:bg-text-dark-secondary';

const VISUAL_COLORS: Record<'spinner' | 'stop' | 'ready' | 'idle', string> = {
  spinner: PRIMARY_BG,
  stop: PRIMARY_BG,
  ready: PRIMARY_BG,
  idle: 'bg-surface-tertiary dark:bg-surface-dark-tertiary',
};

export function SendButton({
  status,
  disabled,
  onClick,
  type = 'button',
  className = '',
  showLoadingSpinner = false,
}: SendButtonProps) {
  const isActive = status === 'loading' || status === 'streaming';
  const hasMessage = status === 'ready';

  const showSpinnerIcon = showLoadingSpinner && status === 'loading';
  const showStopIcon = !showSpinnerIcon && isActive;

  const scaleClass = hasMessage && !disabled ? 'scale-100' : 'scale-90';
  const colorClasses = showSpinnerIcon
    ? VISUAL_COLORS.spinner
    : showStopIcon
      ? VISUAL_COLORS.stop
      : hasMessage
        ? VISUAL_COLORS.ready
        : VISUAL_COLORS.idle;
  let ariaLabel: string;
  let icon: React.ReactNode;

  if (showSpinnerIcon) {
    ariaLabel = 'Starting chat';
    icon = (
      <LoaderCircle className="h-3.5 w-3.5 animate-spin text-text-dark-primary motion-reduce:animate-none dark:text-text-primary" />
    );
  } else if (showStopIcon) {
    ariaLabel = 'Stop generating';
    icon = (
      <Pause className="h-3 w-3 animate-pulse text-surface motion-reduce:animate-none dark:text-surface-dark" />
    );
  } else {
    ariaLabel = 'Send message';
    icon = (
      <ArrowUp
        className={`h-3.5 w-3.5 transition-transform ${hasMessage ? 'text-text-dark-primary dark:text-text-primary' : 'text-text-quaternary'}`}
      />
    );
  }

  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled}
      variant="unstyled"
      className={`${BASE_CLASSES} ${scaleClass} ${colorClasses} ${className}`}
      aria-label={ariaLabel}
    >
      {icon}
    </Button>
  );
}
