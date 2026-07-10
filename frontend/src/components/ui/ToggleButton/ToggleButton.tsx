import { memo } from 'react';
import { PanelLeft, PanelLeftClose } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import styles from './ToggleButton.module.scss';

export interface ToggleButtonProps {
  isOpen: boolean;
  onClick: () => void;
  position?: 'left' | 'right';
  className?: string;
  iconDirection?: 'default' | 'reverse';
  ariaLabel?: string;
}

export const ToggleButton = memo(function ToggleButton({
  isOpen,
  onClick,
  position = 'right',
  className = '',
  iconDirection = 'default',
  ariaLabel,
}: ToggleButtonProps) {
  const shouldInvert = iconDirection === 'reverse';
  const Icon = isOpen !== shouldInvert ? PanelLeftClose : PanelLeft;

  const tooltipText =
    position === 'left'
      ? isOpen
        ? 'Close sidebar'
        : 'Open sidebar'
      : isOpen
        ? 'Close editor'
        : 'Open editor';

  return (
    <FloatingTooltip content={tooltipText} className={styles['toggle-button']}>
      <Button
        type="button"
        onClick={onClick}
        variant="ghost"
        size="icon"
        className={clsx(styles['icon-button'], className)}
        aria-label={ariaLabel ?? tooltipText}
      >
        <Icon className={styles.icon} />
      </Button>
    </FloatingTooltip>
  );
});
