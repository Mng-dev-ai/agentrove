import { type ReactNode, type Ref, type MouseEvent as ReactMouseEvent } from 'react';
import clsx from 'clsx';
import { Button } from '../primitives/Button/Button';
import styles from './MenuRow.module.scss';

export interface MenuRowProps {
  id: string;
  index: number;
  isActive: boolean;
  itemRef: Ref<HTMLDivElement> | undefined;
  onActivate: (index: number, e: ReactMouseEvent) => void;
  onSelect: () => void;
  disabled?: boolean;
  trailing?: ReactNode;
  children: ReactNode;
}

// Shared row shell: active highlight, synthetic-hover guard, option semantics.
export function MenuRow({
  id,
  index,
  isActive,
  itemRef,
  onActivate,
  onSelect,
  disabled,
  trailing,
  children,
}: MenuRowProps) {
  return (
    <div
      ref={itemRef}
      className={clsx(styles.row, isActive && styles['row--active'])}
      onMouseMove={(e) => onActivate(index, e)}
    >
      <Button
        variant="unstyled"
        id={id}
        role="option"
        aria-selected={isActive}
        className={styles.option}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onSelect}
        disabled={disabled}
      >
        {children}
      </Button>
      {trailing}
    </div>
  );
}
