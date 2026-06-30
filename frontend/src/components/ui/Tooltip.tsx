import { ReactNode } from 'react';
import { cn } from '@/utils/cn';

interface TooltipProps {
  content: string;
  children: ReactNode;
  // 'bottom-end' drops below the trigger but right-aligns the bubble, so tooltips
  // on right-edge controls (e.g. the view switcher) grow leftward and never clip.
  position?: 'top' | 'right' | 'bottom' | 'bottom-end' | 'left';
  className?: string;
}

const positionClasses = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  'bottom-end': 'top-full right-0 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
};

const arrowClasses = {
  top: 'top-full left-1/2 -translate-x-1/2 border-t-surface-tertiary dark:border-t-surface-dark-tertiary border-x-transparent border-b-transparent',
  right:
    'right-full top-1/2 -translate-y-1/2 border-r-surface-tertiary dark:border-r-surface-dark-tertiary border-y-transparent border-l-transparent',
  bottom:
    'bottom-full left-1/2 -translate-x-1/2 border-b-surface-tertiary dark:border-b-surface-dark-tertiary border-x-transparent border-t-transparent',
  'bottom-end':
    'bottom-full right-2 border-b-surface-tertiary dark:border-b-surface-dark-tertiary border-x-transparent border-t-transparent',
  left: 'left-full top-1/2 -translate-y-1/2 border-l-surface-tertiary dark:border-l-surface-dark-tertiary border-y-transparent border-r-transparent',
};

export function Tooltip({ content, children, position = 'right', className }: TooltipProps) {
  return (
    <div className={cn('group/tooltip relative inline-flex', className)}>
      {children}
      <div
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 whitespace-nowrap rounded bg-surface-tertiary px-2 py-1 text-xs font-medium text-text-primary opacity-0 shadow-lg transition-opacity duration-150 group-hover/tooltip:opacity-100 dark:bg-surface-dark-tertiary dark:text-text-dark-primary',
          positionClasses[position],
        )}
      >
        {content}
        <span
          className={cn('absolute h-0 w-0 border-4', arrowClasses[position])}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
