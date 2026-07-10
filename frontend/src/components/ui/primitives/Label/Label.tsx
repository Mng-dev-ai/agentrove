import { type LabelHTMLAttributes, type Ref } from 'react';
import clsx from 'clsx';
import styles from './Label.module.scss';

export interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  ref?: Ref<HTMLLabelElement>;
  requiredIndicator?: boolean;
}

export function Label({
  ref,
  className,
  children,
  requiredIndicator = false,
  ...props
}: LabelProps) {
  return (
    <label ref={ref} className={clsx(styles.label, className)} {...props}>
      {children}
      {requiredIndicator ? <span className={styles['required-indicator']}>*</span> : null}
    </label>
  );
}
