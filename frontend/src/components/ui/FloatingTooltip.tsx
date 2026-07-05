import { ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  // Tracks the whole hover interaction (show delay + visible) so the scroll
  // listener can also cancel a pending show timer, not just an open tooltip
  const [hovering, setHovering] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const showTimerRef = useRef<number | null>(null);

  const handleMouseEnter = () => {
    setHovering(true);
    showTimerRef.current = window.setTimeout(() => {
      // Measure at show time, not mouse-enter — the list may scroll during the delay
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPosition({ top: rect.bottom + 4, left: rect.left });
    }, SHOW_DELAY_MS);
  };

  const hide = () => {
    if (showTimerRef.current != null) window.clearTimeout(showTimerRef.current);
    showTimerRef.current = null;
    setHovering(false);
    setPosition(null);
  };

  // mouseleave never fires when the trigger scrolls out from under a stationary
  // pointer — dismiss on any scroll, whether the bubble is shown or still pending
  useEffect(() => {
    if (!hovering) return;
    window.addEventListener('scroll', hide, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', hide, { capture: true });
  }, [hovering]);

  return (
    <div
      ref={triggerRef}
      className={className}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={hide}
      // Clicks re-render/cover the trigger without a mouseleave (nav, menus, drag start)
      onMouseDown={hide}
    >
      {children}
      {/* Portal to body: transformed ancestors (e.g. the sliding sidebar) re-anchor
          position:fixed, which offset the bubble away from the hovered trigger */}
      {position != null &&
        content &&
        createPortal(
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
          </div>,
          document.body,
        )}
    </div>
  );
}
