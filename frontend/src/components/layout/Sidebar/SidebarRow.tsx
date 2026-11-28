import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { stateClasses } from '@/config/stateClasses';
import styles from './SidebarRow.module.scss';

interface SidebarRowProps {
  isActive: boolean;
  isRevealed: boolean;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  timestamp: ReactNode;
  // The trailing slot carries status (wider than a time): it stays visible, beside
  // the dropdown, instead of yielding to it
  isTimestampStatus?: boolean;
  dropdownLabel: string;
  onDropdownClick: (e: MouseEvent<HTMLButtonElement>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function SidebarRow({
  isActive,
  isRevealed,
  leading,
  title,
  subtitle,
  timestamp,
  isTimestampStatus = false,
  dropdownLabel,
  onDropdownClick,
  onMouseEnter,
  onMouseLeave,
}: SidebarRowProps) {
  // Keep the active row visible when navigation lands on an off-screen row
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isActive) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isActive]);
  return (
    <div
      ref={rowRef}
      className={clsx(styles.row, isActive && stateClasses.ACTIVE)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={styles['title-col']}>
        <div className={styles['title-row']}>
          {leading}
          {title}
        </div>
        {subtitle}
      </div>

      {/* Timestamp; hides on hover for the dropdown. Status is on the leading icon. */}
      <span
        className={clsx(
          styles.timestamp,
          isTimestampStatus && styles['timestamp--status'],
          !isTimestampStatus && isRevealed && styles['timestamp--hidden'],
        )}
      >
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
      data-sidebar-thread
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
