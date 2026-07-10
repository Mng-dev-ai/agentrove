import { memo } from 'react';
import { Button } from '@/components/ui/primitives/Button/Button';
import styles from './PromptSuggestions.module.scss';

interface PromptSuggestionsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
}

export const PromptSuggestions = memo(function PromptSuggestions({
  suggestions,
  onSelect,
}: PromptSuggestionsProps) {
  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  return (
    <div className={styles['prompt-suggestions']}>
      {suggestions.map((suggestion, index) => (
        <Button
          variant="unstyled"
          key={`${index}-${suggestion}`}
          type="button"
          onClick={() => onSelect(suggestion)}
          className={styles.suggestion}
        >
          {suggestion}
        </Button>
      ))}
    </div>
  );
});
