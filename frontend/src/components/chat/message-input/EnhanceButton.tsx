import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';

export interface EnhanceButtonProps {
  onEnhance?: () => void;
  isEnhancing?: boolean;
  disabled?: boolean;
}

export function EnhanceButton({
  onEnhance,
  isEnhancing = false,
  disabled = false,
}: EnhanceButtonProps) {
  return (
    <FloatingTooltip
      content={isEnhancing ? 'Enhancing prompt\u2026' : 'Enhance prompt with AI'}
      className="flex"
    >
      <Button
        type="button"
        onClick={onEnhance}
        onMouseDown={(event) => {
          // Preserve the textarea selection so enhance can act on the current prompt without blurring the composer.
          event.preventDefault();
        }}
        disabled={disabled || isEnhancing}
        variant="unstyled"
        className={`group rounded-full p-1.5 transition-colors duration-200 ${
          disabled || isEnhancing
            ? 'cursor-not-allowed text-text-tertiary opacity-50 dark:text-text-dark-tertiary'
            : 'bg-transparent text-text-tertiary hover:bg-surface-hover hover:text-text-secondary active:scale-95 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary'
        }`}
        aria-label={isEnhancing ? 'Enhancing prompt\u2026' : 'Enhance prompt'}
      >
        <Sparkles className={`h-3 w-3 ${isEnhancing ? 'animate-spin' : ''}`} />
      </Button>
    </FloatingTooltip>
  );
}
