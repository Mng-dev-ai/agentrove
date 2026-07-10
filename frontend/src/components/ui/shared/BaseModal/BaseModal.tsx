import { ReactNode } from 'react';
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

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
    >
      <div
        className={clsx(styles.container, styles[`container--${size}`], className)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
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
