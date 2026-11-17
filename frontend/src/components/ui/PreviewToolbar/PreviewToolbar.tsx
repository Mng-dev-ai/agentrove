import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import styles from './PreviewToolbar.module.scss';

interface PreviewToolbarProps {
  title: string;
  meta?: ReactNode;
  tone?: 'surface' | 'scrim';
  children: ReactNode;
}

export function PreviewToolbar({ title, meta, tone = 'surface', children }: PreviewToolbarProps) {
  return (
    <div className={clsx(styles.toolbar, styles[`toolbar--${tone}`])}>
      <div className={styles.heading}>
        <span className={styles.title} title={title}>
          {title}
        </span>
        {meta && <span className={styles.meta}>{meta}</span>}
      </div>
      <div className={styles.actions}>{children}</div>
    </div>
  );
}

interface PreviewToolbarButtonProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  shortcut?: string;
  disabled?: boolean;
}

export function PreviewToolbarButton({
  label,
  icon: Icon,
  onClick,
  shortcut,
  disabled,
}: PreviewToolbarButtonProps) {
  return (
    <FloatingTooltip
      content={shortcut ? `${label}  ${shortcut}` : label}
      className={styles['tooltip-anchor']}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={styles.button}
      >
        <Icon className={styles.icon} />
      </Button>
    </FloatingTooltip>
  );
}
