import { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Tooltip.module.scss';

interface TooltipProps {
  content: string;
  children: ReactNode;
  // 'bottom-end' drops below the trigger but right-aligns the bubble, so tooltips
  // on right-edge controls (e.g. the view switcher) grow leftward and never clip.
  position?: 'top' | 'right' | 'bottom' | 'bottom-end' | 'left';
  className?: string;
}

export function Tooltip({ content, children, position = 'right', className }: TooltipProps) {
  return (
    <div className={clsx(styles['tooltip-wrapper'], className)}>
      {children}
      <div role="tooltip" className={clsx(styles.bubble, styles[`bubble--${position}`])}>
        {content}
        <span className={clsx(styles.arrow, styles[`arrow--${position}`])} aria-hidden="true" />
      </div>
    </div>
  );
}
