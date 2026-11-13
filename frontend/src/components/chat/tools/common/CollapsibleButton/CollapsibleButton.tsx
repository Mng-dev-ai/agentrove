import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './CollapsibleButton.module.scss';

interface CollapsibleButtonProps {
  label: string;
  isExpanded: boolean;
  onToggle: () => void;
  count?: number;
  fullWidth?: boolean;
}

export function CollapsibleButton({
  label,
  isExpanded,
  onToggle,
  count,
  fullWidth = false,
}: CollapsibleButtonProps) {
  const displayLabel = count !== undefined ? `${label} (${count})` : label;

  return (
    <Button
      type="button"
      onClick={onToggle}
      variant="unstyled"
      className={clsx(styles.button, fullWidth && styles['button--full'])}
    >
      <span>{displayLabel}</span>
      <ChevronDown className={clsx(styles.chevron, isExpanded && styles['chevron--expanded'])} />
    </Button>
  );
}
