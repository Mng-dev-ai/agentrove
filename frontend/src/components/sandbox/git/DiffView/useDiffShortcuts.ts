import { useEffect, useRef, type RefObject } from 'react';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || !!target.closest('input, textarea, select');
}

// Single-key shortcuts, live only while the diff view holds focus. Clicking the
// diff body leaves focus on <body> (its rows aren't focusable), so a pointerdown
// inside the view also counts until the next pointerdown elsewhere.
export function useDiffShortcuts(
  rootRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  shortcuts: Record<string, () => void>,
) {
  const pointerInsideRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (event: PointerEvent) => {
      pointerInsideRef.current = !!rootRef.current?.contains(event.target as Node);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const action = shortcuts[event.key];
      if (!action || isEditable(event.target)) return;
      const root = rootRef.current;
      const active = document.activeElement;
      const focusInside =
        !!root && (root.contains(active) || (active === document.body && pointerInsideRef.current));
      if (!focusInside) return;
      event.preventDefault();
      action();
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled, rootRef, shortcuts]);
}
