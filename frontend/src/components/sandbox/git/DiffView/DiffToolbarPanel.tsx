import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { useAnchoredPanel } from '@/hooks/useAnchoredPanel';

export type AnchoredPanel = ReturnType<typeof useAnchoredPanel>;

interface DiffToolbarPanelProps {
  panel: AnchoredPanel;
  width: number;
  className: string;
  children: ReactNode;
}

export function DiffToolbarPanel({ panel, width, className, children }: DiffToolbarPanelProps) {
  if (!panel.isOpen) return null;
  return createPortal(
    <div
      ref={panel.panelRef}
      style={{ top: panel.pos.top, left: panel.pos.left, width }}
      className={className}
    >
      {children}
    </div>,
    document.body,
  );
}
