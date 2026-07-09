import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import styles from './DiffEmptyState.module.scss';

export function DiffEmptyState({
  icon: Icon,
  label,
  sublabel,
  children,
}: {
  icon: LucideIcon;
  label: string;
  sublabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles['empty-state']}>
      <Icon className={styles['empty-icon']} />
      <span className={styles['empty-label']}>{label}</span>
      {sublabel && <span className={styles['empty-sublabel']}>{sublabel}</span>}
      {children}
    </div>
  );
}
