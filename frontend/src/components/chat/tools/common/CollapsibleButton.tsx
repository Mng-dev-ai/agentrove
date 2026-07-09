import React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';

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
      className={`flex items-center ${fullWidth ? 'w-full justify-between gap-2' : 'gap-1'} group/button px-0 py-0.5 text-xs font-medium text-text-tertiary transition-colors duration-200 hover:text-text-primary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary`}
    >
      <span>{displayLabel}</span>
      <ChevronDown
        className={`h-3.5 w-3.5 transition-transform duration-300 ease-out group-hover/button:text-text-primary dark:group-hover/button:text-text-dark-primary ${isExpanded ? 'rotate-180' : ''}`}
      />
    </Button>
  );
};
