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
  triggerLeft: number;
  triggerRight: number;
}

interface FloatingTooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  // Renders the trigger as a span so it can sit inside running text (e.g. a <p>).
  inline?: boolean;
  // 'right' opens beside the trigger, top-aligned, so it doesn't cover the rows below;
  // it falls back to below when the viewport has no room on the right
  placement?: 'below' | 'right';
}

// Fixed-position title replacement — unlike CSS Tooltip, won't clip inside overflow lists.
export function FloatingTooltip({
  content,
  children,
  className,
  inline = false,
  placement = 'below',
}: FloatingTooltipProps) {
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  // Covers show delay + visible so scroll can cancel a pending show, not just an open tip.
  const [hovering, setHovering] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const showTimerRef = useRef<number | null>(null);

  const handlePointerEnter = (e: ReactPointerEvent<HTMLElement>) => {
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
          triggerLeft: rect.left,
          triggerRight: rect.right,
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
    const belowTop = openAbove
      ? position.triggerTop - TOOLTIP_GAP - height
      : position.triggerBottom + TOOLTIP_GAP;
    const opensRight =
      placement === 'right' &&
      position.triggerRight + TOOLTIP_GAP + width <= window.innerWidth - VIEWPORT_PADDING;
    const desiredTop = opensRight ? position.triggerTop : belowTop;
    const desiredLeft = opensRight ? position.triggerRight + TOOLTIP_GAP : position.triggerLeft;
    const top = Math.max(
      VIEWPORT_PADDING,
      Math.min(desiredTop, window.innerHeight - VIEWPORT_PADDING - height),
    );
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(desiredLeft, window.innerWidth - VIEWPORT_PADDING - width),
    );

    if (top !== position.top || left !== position.left) {
      setPosition({ ...position, top, left });
    }
  }, [position, placement]);

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
    const handleScroll = (e: Event) => {
      if ((e.target as Node).contains(triggerRef.current)) hide();
    };
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    window.addEventListener('blur', hide);
    document.addEventListener('pointerdown', hide, { capture: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(hoverCheckTimer);
      window.removeEventListener('scroll', handleScroll, { capture: true });
      window.removeEventListener('blur', hide);
      document.removeEventListener('pointerdown', hide, { capture: true });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [hovering]);

  const Trigger = inline ? 'span' : 'div';
  const setTriggerRef = (el: HTMLElement | null) => {
    triggerRef.current = el;
  };

  return (
    <Trigger
      ref={setTriggerRef}
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
    </Trigger>
  );
}
