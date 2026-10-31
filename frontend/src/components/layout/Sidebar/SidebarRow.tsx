import type { MouseEvent, ReactNode, Ref } from 'react';
import clsx from 'clsx';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { stateClasses } from '@/config/stateClasses';
import styles from './SidebarRow.module.scss';

interface SidebarRowProps {
  ref?: Ref<HTMLDivElement>;
  isActive: boolean;
  isRevealed: boolean;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  timestamp: string;
  dropdownLabel: string;
  onDropdownClick: (e: MouseEvent<HTMLButtonElement>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function SidebarRow({
  ref,
  isActive,
  isRevealed,
  leading,
  title,
  subtitle,
  timestamp,
  dropdownLabel,
  onDropdownClick,
  onMouseEnter,
  onMouseLeave,
}: SidebarRowProps) {
  return (
    <div
      ref={ref}
      className={clsx(styles.row, isActive && stateClasses.ACTIVE)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Pad for timestamp/dropdown so long titles truncate before them. */}
      <div className={styles['title-col']}>
        <div className={styles['title-row']}>
          {leading}
          {title}
        </div>
        {subtitle}
      </div>

      {/* Timestamp; hides on hover for the dropdown. Status is on the leading icon. */}
      <span className={clsx(styles.timestamp, isRevealed && styles['timestamp--hidden'])}>
        {timestamp}
      </span>

      <Button
        onClick={onDropdownClick}
        onMouseDown={(e) => e.stopPropagation()}
        variant="unstyled"
        className={clsx(styles['dropdown-btn'], isRevealed && styles['dropdown-btn--visible'])}
        aria-label={dropdownLabel}
      >
        <MoreHorizontal className={styles['dropdown-icon']} />
      </Button>
    </div>
  );
}

interface SidebarRowTitleProps {
  label: string;
  isEmphasized: boolean;
  isCurrent: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  trailing?: ReactNode;
}

export function SidebarRowTitle({
  label,
  isEmphasized,
  isCurrent,
  onClick,
  trailing,
}: SidebarRowTitleProps) {
  return (
    <Button
      onClick={onClick}
      aria-current={isCurrent ? 'page' : undefined}
      variant="unstyled"
      className={styles['title-btn']}
    >
      <span className={clsx(styles['title-text'], isEmphasized && styles['title-text--emphasis'])}>
        {label}
      </span>
      {trailing}
    </Button>
  );
}
