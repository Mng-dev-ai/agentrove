import { type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './FilterMenu.module.scss';

export function FilterCategoryRow({
  label,
  summary,
  active,
  expanded,
  onOpen,
  onLeave,
}: {
  label: string;
  summary: string;
  active: boolean;
  expanded: boolean;
  onOpen: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onLeave: () => void;
}) {
  return (
    <Button
      variant="unstyled"
      onClick={onOpen}
      onMouseEnter={onOpen}
      onMouseLeave={onLeave}
      aria-haspopup="menu"
      aria-expanded={expanded}
      className={styles['category-row']}
    >
      {label}
      <span className={styles['category-value']}>
        <span
          className={clsx(styles['category-summary'], active && styles['category-summary--active'])}
        >
          {summary}
        </span>
        <ChevronRight className={styles['category-chevron']} />
      </span>
    </Button>
  );
}

export function FilterOptionRow({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="unstyled"
      onClick={onSelect}
      className={clsx(styles['option-row'], selected && styles['option-row--selected'])}
    >
      <span className={styles['option-label']}>{children}</span>
      {selected && <Check className={styles['option-check']} />}
    </Button>
  );
}
