import { ReactNode, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useModalLayer } from './useModalLayer';
import styles from './BaseModal.module.scss';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | 'full';

export interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: ModalSize;
  className?: string;
  ariaLabel?: string;
  variant?: 'dialog' | 'lightbox' | 'sheet';
}

export function BaseModal({
  isOpen,
  onClose,
  children,
  size = 'md',
  className,
  ariaLabel,
  variant = 'dialog',
}: BaseModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pressOnBackdrop = useRef(false);
  // A sheet stays mounted after isOpen drops until its exit animation ends
  const [sheetMounted, setSheetMounted] = useState(false);
  if (variant === 'sheet' && isOpen && !sheetMounted) setSheetMounted(true);
  const closing = variant === 'sheet' && sheetMounted && !isOpen;
  const shown = isOpen || closing;
  useModalLayer(containerRef, shown, onClose);

  if (!shown) return null;

  return createPortal(
    <div
      className={clsx(
        styles.backdrop,
        variant !== 'dialog' && styles[`backdrop--${variant}`],
        closing && styles['backdrop--closing'],
      )}
      onAnimationEnd={(e) => {
        if (closing && e.target === e.currentTarget) setSheetMounted(false);
      }}
      onMouseDown={(e) => {
        pressOnBackdrop.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        pressOnBackdrop.current &&= e.target === e.currentTarget;
      }}
      onClick={() => {
        if (pressOnBackdrop.current) onClose();
      }}
      role="presentation"
    >
      <div
        ref={containerRef}
        className={clsx(
          styles.container,
          styles[`container--${size}`],
          variant !== 'dialog' && styles[`container--${variant}`],
          className,
        )}
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
