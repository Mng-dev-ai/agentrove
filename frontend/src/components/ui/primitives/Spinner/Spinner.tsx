import { type HTMLAttributes, type Ref } from 'react';
import clsx from 'clsx';
import styles from './Spinner.module.scss';

type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  ref?: Ref<HTMLSpanElement>;
  size?: SpinnerSize;
}

export function Spinner({ ref, size = 'md', className, ...props }: SpinnerProps) {
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={clsx(styles.spinner, styles[`spinner--${size}`], className)}
      {...props}
    />
  );
}
