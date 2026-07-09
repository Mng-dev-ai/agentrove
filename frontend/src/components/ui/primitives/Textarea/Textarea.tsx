import { type TextareaHTMLAttributes, type Ref } from 'react';
import clsx from 'clsx';
import styles from './Textarea.module.scss';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
  hasError?: boolean;
  variant?: 'default' | 'unstyled';
}

export function Textarea({
  ref,
  className,
  hasError = false,
  disabled,
  variant = 'default',
  ...props
}: TextareaProps) {
  return (
    <textarea
      ref={ref}
      className={clsx(
        variant === 'unstyled'
          ? styles['textarea-unstyled']
          : [styles.textarea, hasError && styles['textarea--error']],
        className,
      )}
      disabled={disabled}
      {...props}
    />
  );
}
