import { memo } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';

interface ScrollButtonProps {
  onClick: () => void;
}

export const ScrollButton = memo(function ScrollButton({ onClick }: ScrollButtonProps) {
  return (
    <div className="absolute inset-x-0 bottom-full flex justify-center">
      <Button
        onClick={onClick}
        variant="unstyled"
        className="group flex h-8 w-8 items-center justify-center rounded-full border border-border/50 bg-surface shadow-soft transition-colors duration-200 ease-out hover:scale-110 hover:bg-surface-hover active:scale-95 dark:border-border-dark/50 dark:bg-surface-dark dark:hover:bg-surface-dark-hover"
        aria-label="Scroll to bottom"
      >
        <ChevronDown className="h-4 w-4 text-text-secondary transition-colors duration-200 group-hover:text-text-primary dark:text-text-dark-secondary dark:group-hover:text-text-dark-primary" />
      </Button>
    </div>
  );
});
