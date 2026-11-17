import { RefObject, useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open dialogs in mount order; only the last one answers Escape/Tab.
const openStack: HTMLDivElement[] = [];

// For document-level Escape handlers, which run before the modal layer's window listener:
// true (and the key is consumed) only when nothing handled it and no dialog sits above `element`.
export const claimEscape = (event: KeyboardEvent, element: Node | null) => {
  const top = openStack[openStack.length - 1];
  if (
    event.key !== 'Escape' ||
    event.defaultPrevented ||
    !element ||
    (top !== undefined && !top.contains(element))
  ) {
    return false;
  }
  event.preventDefault();
  return true;
};

// <main> is focusable only while it holds focus, so clicks inside it still leave focus on body.
export const focusMainContent = () => {
  const main = document.getElementById('main-content');
  if (!main) return;
  main.tabIndex = -1;
  main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
  main.focus({ preventScroll: true });
};

export function useModalLayer(
  containerRef: RefObject<HTMLDivElement | null>,
  isOpen: boolean,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Read during the opening render: a child's autoFocus runs in commit, before any effect.
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (isOpen && !wasOpenRef.current) {
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpenRef.current = isOpen;

  useEffect(() => {
    const container = containerRef.current;
    if (!isOpen || !container) return;
    const trigger = triggerRef.current;
    openStack.push(container);
    if (!container.contains(document.activeElement)) container.focus({ preventScroll: true });

    // Window bubble phase runs after inner overlays' handlers, so a dropdown or
    // menu that handles Escape (preventDefault) closes before the dialog does.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== container || e.defaultPrevented || e.isComposing) {
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === 'Tab') {
        const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.getClientRects().length > 0,
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (!first || !last) {
          e.preventDefault();
          container.focus();
        } else if (
          !container.contains(active) ||
          (e.shiftKey && (active === first || active === container))
        ) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      openStack.splice(openStack.indexOf(container), 1);
      // StrictMode's simulated unmount keeps the dialog in the DOM; restore only on a real close.
      if (container.isConnected) return;
      trigger?.focus();
      // The trigger can be gone or hidden (a closed mobile drawer); never leave focus on body.
      if (document.activeElement === document.body) focusMainContent();
    };
  }, [containerRef, isOpen]);
}
