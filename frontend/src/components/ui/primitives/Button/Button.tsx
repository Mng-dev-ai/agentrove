import { type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import clsx from 'clsx';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import styles from './Button.module.scss';

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'destructive'
  | 'link'
  | 'gradient'
  | 'unstyled';

type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  loadingText?: string;
  loadingIcon?: ReactNode;
}

export function Button({
  ref,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  loadingText,
  loadingIcon,
  className,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const spinnerSize = size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : 'md';
  const spinner = loadingIcon ?? <Spinner size={spinnerSize} />;

  const content = (
    <>
      {isLoading && spinner}
      {isLoading && loadingText ? loadingText : children}
    </>
  );

  if (variant === 'unstyled') {
    return (
      <button
        ref={ref}
        className={clsx(styles['button-unstyled'], className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {content}
      </button>
    );
  }

  return (
    <button
      ref={ref}
      className={clsx(
        styles.button,
        styles[`button--${size}`],
        styles[`button--${variant}`],
        className,
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {content}
    </button>
  );
}
