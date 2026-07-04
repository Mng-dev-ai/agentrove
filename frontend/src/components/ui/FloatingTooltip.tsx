import { ReactNode, useRef, useState } from 'react';
import { cn } from '@/utils/cn';

// Matches the native title-attribute hover delay so tooltips don't flash while scanning a list
const SHOW_DELAY_MS = 500;

interface FloatingTooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
}

// Themed replacement for the native title attribute. Unlike Tooltip (pure CSS,
// absolute), it renders position:fixed so triggers inside overflow-y-auto lists
// (e.g. the sidebar) don't clip the bubble or add phantom scroll space.
export function FloatingTooltip({ content, children, className }: FloatingTooltipProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const showTimerRef = useRef<number | null>(null);

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    showTimerRef.current = window.setTimeout(
      () => setPosition({ top: rect.bottom + 4, left: rect.left }),
      SHOW_DELAY_MS,
    );
  };

  const handleMouseLeave = () => {
    if (showTimerRef.current != null) window.clearTimeout(showTimerRef.current);
    showTimerRef.current = null;
    setPosition(null);
  };

  return (
    <div className={className} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {children}
      {position != null && content && (
        <div
          role="tooltip"
          style={{ top: position.top, left: position.left }}
          className={cn(
            'pointer-events-none fixed z-50 max-w-[280px] whitespace-pre-line break-words rounded px-2 py-1',
            'animate-fade-in bg-surface-tertiary text-xs font-medium text-text-primary shadow-lg',
            'dark:bg-surface-dark-tertiary dark:text-text-dark-primary',
          )}
        >
          {content}
        </div>
      )}
    </div>
  );
}
