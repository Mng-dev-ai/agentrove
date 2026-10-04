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
