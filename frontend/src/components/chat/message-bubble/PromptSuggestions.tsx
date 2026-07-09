import { memo } from 'react';
import { Button } from '@/components/ui/primitives/Button/Button';

interface PromptSuggestionsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
}

const PromptSuggestionsInner: React.FC<PromptSuggestionsProps> = ({ suggestions, onSelect }) => {
  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {suggestions.map((suggestion, index) => (
        <Button
          variant="unstyled"
          key={`${index}-${suggestion}`}
          type="button"
          onClick={() => onSelect(suggestion)}
          className="rounded-md bg-surface-tertiary/60 px-2.5 py-1 text-2xs text-text-tertiary transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary dark:bg-surface-dark-tertiary/60 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
        >
          {suggestion}
        </Button>
      ))}
    </div>
  );
};

export const PromptSuggestions = memo(PromptSuggestionsInner);
