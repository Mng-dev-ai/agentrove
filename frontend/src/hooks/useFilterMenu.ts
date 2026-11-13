import { useEffect, useRef, useState } from 'react';

export const FILTER_PANEL_WIDTH = 240;
export const FILTER_SUBMENU_WIDTH = 200;
// Grace delay lets the pointer cross the gap between a row and its flyout
// without the flyout closing mid-travel
const SUBMENU_GRACE_MS = 150;

export function useFilterMenu<V extends string>({ closeOnEscape = false } = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [submenu, setSubmenu] = useState<{
    view: V;
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const cancelSubmenuClose = () => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleSubmenuClose = () => {
    cancelSubmenuClose();
    closeTimerRef.current = window.setTimeout(() => setSubmenu(null), SUBMENU_GRACE_MS);
  };

  const closeSubmenu = () => setSubmenu(null);

  const closeAll = () => {
    cancelSubmenuClose();
    setSubmenu(null);
    setIsOpen(false);
  };

  const openSubmenu = (view: V, e: React.MouseEvent<HTMLButtonElement>) => {
    cancelSubmenuClose();
    const rect = e.currentTarget.getBoundingClientRect();
    // Flip to the panel's left when the flyout would overflow the viewport;
    // on narrow (mobile) viewports neither side fits, so clamp on-screen —
    // overlapping the root panel beats rendering off the left edge
    const left =
      rect.right + 10 + FILTER_SUBMENU_WIDTH <= window.innerWidth
        ? rect.right + 10
        : Math.max(
            8,
            Math.min(
              rect.left - FILTER_SUBMENU_WIDTH - 10,
              window.innerWidth - FILTER_SUBMENU_WIDTH - 8,
            ),
          );
    const top = Math.max(8, rect.top - 6);
    setSubmenu({ view, top, left, maxHeight: window.innerHeight - top - 8 });
  };

  // The panel and flyout portal to body (out of the trigger's subtree), so
  // outside-click must check all three refs — a single-ref useDropdown would
  // treat every panel/flyout click as outside and close the menu.
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target) ||
        submenuRef.current?.contains(target)
      ) {
        return;
      }
      cancelSubmenuClose();
      setSubmenu(null);
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  // Scrolling the page detaches the fixed panel from its trigger — close it.
  // Scrolls inside the panel or flyout keep it open.
  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = (e: Event) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || submenuRef.current?.contains(target)) return;
      cancelSubmenuClose();
      setSubmenu(null);
      setIsOpen(false);
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      cancelSubmenuClose();
      setSubmenu(null);
      setIsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEscape]);

  return {
    isOpen,
    open: () => setIsOpen(true),
    closeAll,
    submenu,
    openSubmenu,
    closeSubmenu,
    scheduleSubmenuClose,
    cancelSubmenuClose,
    triggerRef,
    panelRef,
    submenuRef,
  };
}
