import { memo } from 'react';
import clsx from 'clsx';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { SearchMatch } from '@/types/sandbox.types';
import styles from './SearchResultLine.module.scss';

export interface SearchResultLineProps {
  match: SearchMatch;
  onClick: () => void;
  isActive?: boolean;
}

export const SearchResultLine = memo(function SearchResultLine({
  match,
  onClick,
  isActive = false,
}: SearchResultLineProps) {
  const { line_text, match_start, match_end } = match;
  const before = line_text.slice(0, match_start);
  const hit = line_text.slice(match_start, match_end);
  const after = line_text.slice(match_end);

  return (
    <Button
      variant="unstyled"
      onClick={onClick}
      className={clsx(
        styles['search-result-line'],
        isActive && styles['search-result-line--active'],
      )}
    >
      <span className={styles['line-number']}>{match.line_number}</span>
      <span className={styles['line-text']}>
        {before}
        <mark className={styles.highlight}>{hit}</mark>
        {after}
      </span>
    </Button>
  );
});
