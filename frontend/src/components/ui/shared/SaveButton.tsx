import { memo } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { cn } from '@/utils/cn';

export interface SaveButtonProps {
  isSaving: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

export const SaveButton = memo(function SaveButton({
  isSaving,
  onClick,
  disabled,
  className,
}: SaveButtonProps) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled || isSaving}
      variant="unstyled"
      className={cn(
        'flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-medium transition-colors duration-200',
        isSaving
          ? 'cursor-not-allowed text-text-quaternary dark:text-text-dark-quaternary'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary',
        className,
      )}
    >
      {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
      {isSaving ? 'Saving' : 'Save'}
    </Button>
  );
});
