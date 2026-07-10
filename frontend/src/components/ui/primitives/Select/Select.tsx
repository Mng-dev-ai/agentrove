import { type SelectHTMLAttributes, type Ref } from 'react';
import clsx from 'clsx';
import styles from './Select.module.scss';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  ref?: Ref<HTMLSelectElement>;
  hasError?: boolean;
}

export function Select({
  ref,
  className,
  hasError = false,
  disabled,
  children,
  ...props
}: SelectProps) {
  return (
    <div className={styles.select}>
      <select
        ref={ref}
        className={clsx(
          styles['select-input'],
          hasError && styles['select-input--error'],
          className,
        )}
        disabled={disabled}
        {...props}
      >
        {children}
      </select>
      <span className={styles['select-chevron']}>
        <svg
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  );
}
