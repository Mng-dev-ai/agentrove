import { type KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import styles from './BaseModal.module.scss';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | 'full';
export type ModalZIndex = 'modal' | 'modalHigh' | 'modalHighest';

export interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: ModalSize;
  // Retained for API compatibility; all tiers share the 'modal' z-layer and stack by
  // portal mount order (see BaseModal.module.scss).
  zIndex?: ModalZIndex;
  className?: string;
  ariaLabel?: string;
}

export function BaseModal({
  isOpen,
  onClose,
  children,
  size = 'md',
  className,
  ariaLabel,
}: BaseModalProps) {
  if (!isOpen) return null;

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && e.target instanceof Node && e.currentTarget.contains(e.target)) {
      onClose();
    }
  };

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        className={clsx(styles.container, styles[`container--${size}`], className)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
