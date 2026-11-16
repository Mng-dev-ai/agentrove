import { useLayoutEffect, useState, type RefObject } from 'react';

const VIEWPORT_MARGIN = 8;

export interface PanelFit {
  side: 'top' | 'bottom';
  maxHeight?: number;
}

export function usePanelFit(
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
  enabled = true,
): PanelFit | null {
  const [fit, setFit] = useState<PanelFit | null>(null);

  if (!isOpen && fit) setFit(null);

  useLayoutEffect(() => {
    if (!isOpen || !enabled || fit) return;
    const anchor = anchorRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!anchor || !panel) return;
    const gap = panel.top - anchor.bottom;
    const below = window.innerHeight - anchor.bottom - gap - VIEWPORT_MARGIN;
    const above = anchor.top - gap - VIEWPORT_MARGIN;
    if (panel.height <= below) setFit({ side: 'bottom' });
    else if (panel.height <= above) setFit({ side: 'top' });
    else
      setFit(
        above > below ? { side: 'top', maxHeight: above } : { side: 'bottom', maxHeight: below },
      );
  }, [isOpen, enabled, fit, anchorRef, panelRef]);

  return fit;
}

// Transform that keeps an anchored panel inside the viewport horizontally. Re-measured
// after every render because the anchor can move while the panel is open.
export function usePanelInlineShift(
  panelRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
): string | undefined {
  const [shift, setShift] = useState(0);

  if (!isOpen && shift !== 0) setShift(0);

  // No deps: next depends only on the unshifted position, so the update settles in one pass.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const panel = panelRef.current?.getBoundingClientRect();
    if (!isOpen || !panel) return;
    const left = panel.left - shift;
    const right = panel.right - shift;
    const viewport = document.documentElement.clientWidth;
    const next = Math.max(VIEWPORT_MARGIN - left, Math.min(0, viewport - VIEWPORT_MARGIN - right));
    if (Math.abs(next - shift) >= 0.5) setShift(next);
  });

  return shift ? `translateX(${shift}px)` : undefined;
}
