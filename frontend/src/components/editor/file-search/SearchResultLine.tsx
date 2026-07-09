import { memo } from 'react';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { SearchMatch } from '@/types/sandbox.types';
import { cn } from '@/utils/cn';

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
      className={cn(
        'flex w-full items-start gap-1.5 rounded px-1.5 py-0.5 text-left font-mono text-2xs leading-5',
        'text-text-secondary dark:text-text-dark-secondary',
        'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
        isActive && 'bg-surface-active dark:bg-surface-dark-active',
      )}
    >
      <span className="min-w-[1.75rem] shrink-0 text-right tabular-nums text-text-quaternary dark:text-text-dark-quaternary">
        {match.line_number}
      </span>
      <span className="truncate whitespace-pre">
        {before}
        <mark className="rounded-sm bg-surface-active px-0.5 text-text-primary dark:bg-surface-dark-hover dark:text-text-dark-primary">
          {hit}
        </mark>
        {after}
      </span>
    </Button>
  );
});
