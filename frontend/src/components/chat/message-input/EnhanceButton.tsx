import { Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import styles from './EnhanceButton.module.scss';

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
      className={styles['tooltip-wrap']}
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
        className={styles['enhance-button']}
        aria-label={isEnhancing ? 'Enhancing prompt\u2026' : 'Enhance prompt'}
      >
        <Sparkles className={clsx(styles.icon, isEnhancing && styles['icon--spinning'])} />
      </Button>
    </FloatingTooltip>
  );
}
