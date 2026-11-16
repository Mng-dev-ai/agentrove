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

// Measured with the inline transform cleared so the result depends only on layout, never on
// the previous shift.
function inlineShift(panel: HTMLElement): number {
  const transform = panel.style.transform;
  panel.style.transform = '';
  const { left, right, width } = panel.getBoundingClientRect();
  panel.style.transform = transform;
  if (!width) return 0;
  const viewport = document.documentElement.clientWidth;
  return Math.max(VIEWPORT_MARGIN - left, Math.min(0, viewport - VIEWPORT_MARGIN - right));
}

// Transform that keeps an anchored panel inside the viewport horizontally. Re-measured
// after every render because the anchor can move while the panel is open.
export function usePanelInlineShift(
  panelRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
): string | undefined {
  const [shift, setShift] = useState(0);

  if (!isOpen && shift !== 0) setShift(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (isOpen && panelRef.current) setShift(inlineShift(panelRef.current));
  });

  return shift ? `translateX(${shift}px)` : undefined;
}
