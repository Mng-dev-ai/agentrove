import { ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import styles from './BaseModal.module.scss';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | 'full';

export interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: ModalSize;
  className?: string;
  ariaLabel?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open dialogs in mount order; only the last one answers Escape/Tab.
const openStack: HTMLDivElement[] = [];

export function BaseModal({
  isOpen,
  onClose,
  children,
  size = 'md',
  className,
  ariaLabel,
}: BaseModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const container = containerRef.current;
    if (!isOpen || !container) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
        } else if (!container.contains(active) || (e.shiftKey && active === first)) {
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
      if (trigger?.isConnected) trigger.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        ref={containerRef}
        className={clsx(styles.container, styles[`container--${size}`], className)}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
