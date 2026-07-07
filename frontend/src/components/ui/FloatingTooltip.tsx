import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/utils/cn';

// Matches the native title-attribute hover delay so tooltips don't flash while scanning a list
const SHOW_DELAY_MS = 500;
const HOVER_CHECK_MS = 100;

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

  const handlePointerEnter = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    setHovering(true);
    showTimerRef.current = window.setTimeout(() => {
      // Measure at show time, not pointer-enter — the list may scroll during the delay
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect && triggerRef.current?.matches(':hover')) {
        setPosition({ top: rect.bottom + 4, left: rect.left });
      }
    }, SHOW_DELAY_MS);
  };

  const hide = () => {
    if (showTimerRef.current != null) window.clearTimeout(showTimerRef.current);
    showTimerRef.current = null;
    setHovering(false);
    setPosition(null);
  };

  // pointerleave alone is unreliable: WKWebView (Tauri) can drop it on fast
  // window exits, native title-bar transitions, and focus changes.
  useEffect(() => {
    if (!hovering) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') hide();
    };
    const hoverCheckTimer = window.setInterval(() => {
      // CSS hover state still updates when WKWebView drops the JS leave event.
      if (!triggerRef.current?.matches(':hover')) hide();
    }, HOVER_CHECK_MS);
    window.addEventListener('scroll', hide, { capture: true, passive: true });
    window.addEventListener('blur', hide);
    document.addEventListener('pointerdown', hide, { capture: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(hoverCheckTimer);
      window.removeEventListener('scroll', hide, { capture: true });
      window.removeEventListener('blur', hide);
      document.removeEventListener('pointerdown', hide, { capture: true });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [hovering]);

  return (
    <div
      ref={triggerRef}
      className={className}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={hide}
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
              'pointer-events-none fixed z-[210] max-w-[280px] whitespace-pre-line break-words rounded px-2 py-1',
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
