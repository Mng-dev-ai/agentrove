import { memo, useMemo } from 'react';
import clsx from 'clsx';
import fuzzysort from 'fuzzysort';
import styles from './HighlightMatch.module.scss';

export interface HighlightMatchProps {
  text: string;
  searchQuery: string;
  className?: string;
}

interface HighlightTextSegment {
  text: string;
  highlighted: boolean;
}

export const HighlightMatch = memo(function HighlightMatch({
  text,
  searchQuery,
  className,
}: HighlightMatchProps) {
  const segments = useMemo((): HighlightTextSegment[] => {
    const trimmedQuery = searchQuery.trim();

    if (!trimmedQuery) {
      return [{ text, highlighted: false }];
    }

    const result = fuzzysort.single(trimmedQuery, text);

    if (!result || !result.indexes) {
      return [{ text, highlighted: false }];
    }

    const highlightedIndexes = new Set(result.indexes);
    const textSegments: HighlightTextSegment[] = [];
    let currentSegment = '';
    let isHighlighted = false;

    for (let i = 0; i < text.length; i++) {
      const shouldHighlight = highlightedIndexes.has(i);

      if (shouldHighlight !== isHighlighted) {
        if (currentSegment) {
          textSegments.push({ text: currentSegment, highlighted: isHighlighted });
        }
        currentSegment = text[i];
        isHighlighted = shouldHighlight;
      } else {
        currentSegment += text[i];
      }
    }

    if (currentSegment) {
      textSegments.push({ text: currentSegment, highlighted: isHighlighted });
    }

    return textSegments;
  }, [text, searchQuery]);

  return (
    <span className={clsx(styles['highlight-match'], className)}>
      {segments.map((segment, index) =>
        segment.highlighted ? (
          <mark key={index} className={styles.mark}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
});
