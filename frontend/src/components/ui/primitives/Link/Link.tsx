import { type AnchorHTMLAttributes, type Ref } from 'react';
import clsx from 'clsx';
import styles from './Link.module.scss';

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  ref?: Ref<HTMLAnchorElement>;
  variant?: 'default' | 'unstyled';
}

export function Link({ ref, className, variant = 'default', ...props }: LinkProps) {
  return (
    <a
      ref={ref}
      className={clsx(variant === 'unstyled' ? styles['link-unstyled'] : styles.link, className)}
      {...props}
    />
  );
}
