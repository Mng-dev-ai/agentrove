import type { ReactNode } from 'react';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useUIStore, type SidebarSection } from '@/store/uiStore';
import styles from './SidebarSectionHeader.module.scss';

interface SidebarSectionHeaderProps {
  title: string;
  section: SidebarSection;
  children?: ReactNode;
}

export function SidebarSectionHeader({ title, section, children }: SidebarSectionHeaderProps) {
  const isCollapsed = useUIStore((state) => state.collapsedSidebarSections.includes(section));
  return (
    <div className={styles.header}>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => useUIStore.getState().toggleSidebarSection(section)}
        aria-expanded={!isCollapsed}
        className={styles.toggle}
      >
        <span className={styles.title}>{title}</span>
        <ChevronRight
          className={clsx(styles.chevron, !isCollapsed && styles['chevron--expanded'])}
        />
      </Button>
      {children}
    </div>
  );
}
