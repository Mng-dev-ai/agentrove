import type { KeyboardEvent } from 'react';
import { useCallback, useRef, useState } from 'react';

interface UseSuggestionBaseOptions<T> {
  suggestions: T[];
  hasSuggestions: boolean;
  onSelect: (item: T) => void;
}

// Keyboard nav for suggestion dropdowns. handleKeyDown is stable (empty deps) and
// reads via refs so consumers don't remount the input when the list changes.
export const useSuggestionBase = <T>({
  suggestions,
  hasSuggestions,
  onSelect,
}: UseSuggestionBaseOptions<T>) => {
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const suggestionsRef = useRef(suggestions);
  const hasSuggestionsRef = useRef(hasSuggestions);
  const onSelectRef = useRef(onSelect);
  const highlightedIndexRef = useRef(highlightedIndex);

  if (suggestionsRef.current !== suggestions || hasSuggestionsRef.current !== hasSuggestions) {
    if (!hasSuggestions) {
      if (highlightedIndex !== 0) setHighlightedIndex(0);
    } else if (highlightedIndex >= suggestions.length) {
      setHighlightedIndex(0);
    }
  }

  suggestionsRef.current = suggestions;
  hasSuggestionsRef.current = hasSuggestions;
  onSelectRef.current = onSelect;
  highlightedIndexRef.current = highlightedIndex;

  const handleKeyDown = useCallback((event: KeyboardEvent<Element>) => {
    if (!hasSuggestionsRef.current) return false;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % suggestionsRef.current.length);
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex(
        (prev) => (prev - 1 + suggestionsRef.current.length) % suggestionsRef.current.length,
      );
      return true;
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      const item = suggestionsRef.current[highlightedIndexRef.current];
      if (item) onSelectRef.current(item);
      return true;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setHighlightedIndex(0);
      return true;
    }

    return false;
  }, []);

  return {
    highlightedIndex,
    selectItem: onSelect,
    handleKeyDown,
  } as const;
};
