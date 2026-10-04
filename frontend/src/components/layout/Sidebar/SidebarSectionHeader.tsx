import type { ReactNode } from 'react';
import styles from './SidebarSectionHeader.module.scss';

interface SidebarSectionHeaderProps {
  title: string;
  children?: ReactNode;
}

export function SidebarSectionHeader({ title, children }: SidebarSectionHeaderProps) {
  return (
    <div className={styles.header}>
      <span className={styles.title}>{title}</span>
      {children}
    </div>
  );
}
