import { memo, KeyboardEvent, ReactNode } from 'react';
import clsx from 'clsx';
import styles from './SelectItem.module.scss';

interface SelectItemProps {
  isSelected: boolean;
  onSelect: () => void;
  className?: string;
  children: ReactNode;
  role?: string;
}

function SelectItemInner({ isSelected, onSelect, className, children, role }: SelectItemProps) {
  // Rendered as a div (not a button) so renderItem can nest secondary interactive controls
  // like a favorite toggle — nesting interactive elements inside a <button> is invalid.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };
  return (
    <div
      role={role}
      tabIndex={0}
      aria-selected={isSelected}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      className={clsx(styles['select-item'], className)}
    >
      {children}
    </div>
  );
}

export const SelectItem = memo(SelectItemInner);
