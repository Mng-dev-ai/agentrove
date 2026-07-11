import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import styles from './FloatingTooltip.module.scss';

// Matches the native title-attribute hover delay so tooltips don't flash while scanning a list
const SHOW_DELAY_MS = 500;
const HOVER_CHECK_MS = 100;
const TOOLTIP_GAP = 4;
const VIEWPORT_PADDING = 8;

interface TooltipPosition {
  top: number;
  left: number;
  triggerTop: number;
  triggerBottom: number;
}

interface FloatingTooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
}

// Themed replacement for the native title attribute. Unlike Tooltip (pure CSS,
// absolute), it renders position:fixed so triggers inside overflow-y-auto lists
// (e.g. the sidebar) don't clip the bubble or add phantom scroll space.
export function FloatingTooltip({ content, children, className }: FloatingTooltipProps) {
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  // Tracks the whole hover interaction (show delay + visible) so the scroll
  // listener can also cancel a pending show timer, not just an open tooltip
  const [hovering, setHovering] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const showTimerRef = useRef<number | null>(null);

  const handlePointerEnter = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    setHovering(true);
    showTimerRef.current = window.setTimeout(() => {
      // Measure at show time, not pointer-enter — the list may scroll during the delay
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect && triggerRef.current?.matches(':hover')) {
        setPosition({
          top: rect.bottom + TOOLTIP_GAP,
          left: rect.left,
          triggerTop: rect.top,
          triggerBottom: rect.bottom,
        });
      }
    }, SHOW_DELAY_MS);
  };

  const hide = () => {
    if (showTimerRef.current != null) window.clearTimeout(showTimerRef.current);
    showTimerRef.current = null;
    setHovering(false);
    setPosition(null);
  };

  useLayoutEffect(() => {
    if (position == null || bubbleRef.current == null) return;

    const { offsetHeight: height, offsetWidth: width } = bubbleRef.current;
    const fitsAbove = position.triggerTop - TOOLTIP_GAP - height >= VIEWPORT_PADDING;
    const fitsBelow =
      position.triggerBottom + TOOLTIP_GAP + height <= window.innerHeight - VIEWPORT_PADDING;
    const openAbove = !fitsBelow && fitsAbove;
    const desiredTop = openAbove
      ? position.triggerTop - TOOLTIP_GAP - height
      : position.triggerBottom + TOOLTIP_GAP;
    const top = Math.max(
      VIEWPORT_PADDING,
      Math.min(desiredTop, window.innerHeight - VIEWPORT_PADDING - height),
    );
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(position.left, window.innerWidth - VIEWPORT_PADDING - width),
    );

    if (top !== position.top || left !== position.left) {
      setPosition({ ...position, top, left });
    }
  }, [position]);

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
      className={clsx(styles['floating-tooltip'], className)}
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
            ref={bubbleRef}
            role="tooltip"
            style={{ top: position.top, left: position.left }}
            className={styles.bubble}
          >
            {content}
          </div>,
          document.body,
        )}
    </div>
  );
}
