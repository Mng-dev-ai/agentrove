import { type InputHTMLAttributes, type Ref } from 'react';
import clsx from 'clsx';
import styles from './Input.module.scss';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
  hasError?: boolean;
  variant?: 'default' | 'unstyled';
}

export function Input({
  ref,
  className,
  type = 'text',
  hasError = false,
  disabled,
  variant = 'default',
  ...props
}: InputProps) {
  return (
    <input
      ref={ref}
      type={type}
      className={clsx(
        variant === 'unstyled'
          ? styles['input-unstyled']
          : [styles.input, hasError && styles['input--error']],
        className,
      )}
      disabled={disabled}
      {...props}
    />
  );
}
