import type { ReactNode } from 'react';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useUIStore, type SidebarSection } from '@/store/uiStore';
import styles from './SidebarSectionHeader.module.scss';

interface SidebarSectionHeaderProps {
  title: string;
  // Omit for a static, non-collapsible header.
  section?: SidebarSection;
  children?: ReactNode;
}

export function SidebarSectionHeader({ title, section, children }: SidebarSectionHeaderProps) {
  return (
    <div className={styles.header}>
      {section ? (
        <CollapseToggle title={title} section={section} />
      ) : (
        <span className={clsx(styles.label, styles.title)}>{title}</span>
      )}
      {children}
    </div>
  );
}

function CollapseToggle({ title, section }: { title: string; section: SidebarSection }) {
  const isCollapsed = useUIStore((state) => state.collapsedSidebarSections.includes(section));
  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={() => useUIStore.getState().toggleSidebarSection(section)}
      aria-expanded={!isCollapsed}
      className={clsx(styles.label, styles.toggle)}
    >
      <span className={styles.title}>{title}</span>
      <ChevronRight className={clsx(styles.chevron, !isCollapsed && styles['chevron--expanded'])} />
    </Button>
  );
}
