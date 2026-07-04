import { useCallback, useEffect, useRef, useState } from 'react';

// Fixed-position panel anchored to a trigger, rendered via portal so it escapes
// overflow-clipping ancestors (e.g. an overflow-x-auto toolbar — CSS clips both
// axes). useDropdown can't cover this: it only handles outside-click for
// panels positioned inside their trigger's stacking context.
export function useAnchoredPanel(
  computePos: (triggerRect: DOMRect) => { top: number; left: number },
) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const toggle = useCallback(() => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    setPos(computePos(trigger.getBoundingClientRect()));
    setIsOpen(true);
  }, [isOpen, computePos]);

  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    // Resize only — document scroll thrashes layout, and any real scroll
    // closes the panel via the mousedown handler anyway.
    const reposition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      setPos(computePos(trigger.getBoundingClientRect()));
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', reposition);
    };
  }, [isOpen, computePos]);

  return { isOpen, pos, triggerRef, panelRef, toggle, close };
}
