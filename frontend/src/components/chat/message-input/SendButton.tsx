import { ArrowUp, LoaderCircle, Pause } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './SendButton.module.scss';

export type SendButtonStatus = 'idle' | 'ready' | 'loading' | 'streaming';

export interface SendButtonProps {
  status: SendButtonStatus;
  disabled: boolean;
  onClick: (e: React.MouseEvent) => void;
  type?: 'button' | 'submit';
  className?: string;
  showLoadingSpinner?: boolean;
}

export function SendButton({
  status,
  disabled,
  onClick,
  type = 'button',
  className,
  showLoadingSpinner = false,
}: SendButtonProps) {
  const isActive = status === 'loading' || status === 'streaming';
  const hasMessage = status === 'ready';

  const showSpinnerIcon = showLoadingSpinner && status === 'loading';
  const showStopIcon = !showSpinnerIcon && isActive;

  // Spinner, stop and ready share the inverted "filled" look; idle stays a muted pill.
  const isPrimary = showSpinnerIcon || showStopIcon || hasMessage;
  let ariaLabel: string;
  let icon: React.ReactNode;

  if (showSpinnerIcon) {
    ariaLabel = 'Starting chat';
    icon = <LoaderCircle className={styles['icon-spinner']} />;
  } else if (showStopIcon) {
    ariaLabel = 'Stop generating';
    icon = <Pause className={styles['icon-stop']} />;
  } else {
    ariaLabel = 'Send message';
    icon = (
      <ArrowUp className={clsx(styles['icon-send'], hasMessage && styles['icon-send--active'])} />
    );
  }

  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled}
      variant="unstyled"
      className={clsx(
        styles['send-button'],
        isPrimary ? styles['send-button--primary'] : styles['send-button--idle'],
        hasMessage && !disabled && styles['send-button--ready'],
        className,
      )}
      aria-label={ariaLabel}
    >
      {icon}
    </Button>
  );
}
