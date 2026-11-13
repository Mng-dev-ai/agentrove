import { type ButtonHTMLAttributes, type MouseEvent, type Ref } from 'react';
import clsx from 'clsx';
import styles from './Switch.module.scss';

type SwitchSize = 'sm' | 'md';

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'role' | 'name'
> {
  ref?: Ref<HTMLButtonElement>;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: SwitchSize;
}

export function Switch({
  ref,
  checked,
  onCheckedChange,
  size = 'md',
  className,
  disabled,
  onClick,
  ...props
}: SwitchProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }

    onCheckedChange?.(!checked);
    onClick?.(event);
  };

  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? 'checked' : 'unchecked'}
      data-disabled={disabled ? '' : undefined}
      className={clsx(styles.switch, styles[`switch--${size}`], className)}
      disabled={disabled}
      onClick={handleClick}
      {...props}
    >
      <span className="sr-only">Toggle</span>
      <span className={styles['switch-track']}>
        <span
          aria-hidden="true"
          className={clsx(styles['switch-thumb'], styles[`switch-thumb--${size}`])}
        />
      </span>
    </button>
  );
}
