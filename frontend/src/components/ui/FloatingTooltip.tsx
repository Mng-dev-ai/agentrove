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

  // mouseleave alone is unreliable: it never fires when the trigger scrolls out
  // from under a stationary pointer, and WKWebView (Tauri) drops it on fast window
  // exits, native drag regions, and focus changes — so back it up with dismissals
  // that don't depend on it: any scroll, any mousedown, window blur, and a
  // hit-test on every mouse move (first in-page move after a missed leave hides)
  useEffect(() => {
    if (!hovering) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!triggerRef.current?.contains(e.target as Node)) hide();
    };
    window.addEventListener('scroll', hide, { capture: true, passive: true });
    window.addEventListener('blur', hide);
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mousedown', hide, { capture: true });
    return () => {
      window.removeEventListener('scroll', hide, { capture: true });
      window.removeEventListener('blur', hide);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mousedown', hide, { capture: true });
    };
  }, [hovering]);

  return (
    <div ref={triggerRef} className={className} onMouseEnter={handleMouseEnter} onMouseLeave={hide}>
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
