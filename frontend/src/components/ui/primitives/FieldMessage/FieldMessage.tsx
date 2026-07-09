import { type ReactNode } from 'react';
import clsx from 'clsx';
import styles from './FieldMessage.module.scss';

interface FieldMessageProps {
  children: ReactNode;
  variant?: 'default' | 'error' | 'success';
  className?: string;
}

export function FieldMessage({ children, variant = 'default', className }: FieldMessageProps) {
  if (!children) {
    return null;
  }

  return (
    <p
      className={clsx(
        styles['field-message'],
        variant !== 'default' && styles[`field-message--${variant}`],
        className,
      )}
    >
      {children}
    </p>
  );
}
