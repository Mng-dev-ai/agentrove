import React from 'react';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './CollapsibleButton.module.scss';

interface CollapsibleButtonProps {
  label: string;
  labelWhenExpanded?: string;
  isExpanded: boolean;
  onToggle: () => void;
  count?: number;
  fullWidth?: boolean;
}

export const CollapsibleButton: React.FC<CollapsibleButtonProps> = ({
  label,
  labelWhenExpanded,
  isExpanded,
  onToggle,
  count,
  fullWidth = false,
}) => {
  const effectiveLabel = isExpanded && labelWhenExpanded ? labelWhenExpanded : label;
  const displayLabel = count !== undefined ? `${effectiveLabel} (${count})` : effectiveLabel;

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
};
