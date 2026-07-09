import { memo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { SearchFileResult } from '@/types/sandbox.types';
import { cn } from '@/utils/cn';
import { getFileName } from '@/utils/file';
import { SearchResultLine } from './SearchResultLine';

export interface SearchResultGroupProps {
  result: SearchFileResult;
  onOpen: (path: string, lineNumber: number) => void;
  activeLine: { path: string; line: number } | null;
}

export const SearchResultGroup = memo(function SearchResultGroup({
  result,
  onOpen,
  activeLine,
}: SearchResultGroupProps) {
  const [expanded, setExpanded] = useState(true);
  const fileName = getFileName(result.path);
  const slashIdx = result.path.lastIndexOf('/');
  const dir = slashIdx === -1 ? '' : result.path.slice(0, slashIdx);
  const isActivePath = activeLine?.path === result.path;

  return (
    <div className="flex flex-col">
      <Button
        variant="unstyled"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-surface-hover dark:hover:bg-surface-dark-hover"
      >
        <ChevronRight
          className={cn(
            'h-3 w-3 shrink-0 text-text-quaternary transition-transform duration-150 dark:text-text-dark-quaternary',
            expanded && 'rotate-90',
          )}
        />
        <span className="truncate text-xs font-medium text-text-primary dark:text-text-dark-primary">
          {fileName}
        </span>
        {dir && (
          <span className="truncate font-mono text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            {dir}
          </span>
        )}
        <span className="ml-auto rounded-full bg-surface-active px-1.5 text-2xs tabular-nums text-text-secondary dark:bg-surface-dark-hover dark:text-text-dark-secondary">
          {result.matches.length}
        </span>
      </Button>

      {expanded && (
        <div className="flex flex-col pl-2">
          {result.matches.map((match, idx) => (
            <SearchResultLine
              key={`${match.line_number}-${idx}`}
              match={match}
              onClick={() => onOpen(result.path, match.line_number)}
              isActive={isActivePath && activeLine?.line === match.line_number}
            />
          ))}
        </div>
      )}
    </div>
  );
});
