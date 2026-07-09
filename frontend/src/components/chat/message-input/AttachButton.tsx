import { Image } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';

export interface AttachButtonProps {
  onAttach?: () => void;
  disabled?: boolean;
}

export function AttachButton({ onAttach, disabled = false }: AttachButtonProps) {
  return (
    <Button
      type="button"
      onClick={onAttach}
      variant="unstyled"
      disabled={disabled}
      className="rounded-full p-1.5 text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
      aria-label="Attach file"
    >
      <Image className="h-3.5 w-3.5" />
    </Button>
  );
}
