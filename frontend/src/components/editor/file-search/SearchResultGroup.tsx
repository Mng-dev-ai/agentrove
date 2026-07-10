import { memo, useState } from 'react';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import type { SearchFileResult } from '@/types/sandbox.types';
import { getFileName } from '@/utils/file';
import { SearchResultLine } from './SearchResultLine';
import styles from './SearchResultGroup.module.scss';

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
    <div className={styles['search-result-group']}>
      <Button
        variant="unstyled"
        onClick={() => setExpanded((prev) => !prev)}
        className={styles['header-button']}
      >
        <ChevronRight className={clsx(styles.chevron, expanded && styles['chevron--expanded'])} />
        <span className={styles['file-name']}>{fileName}</span>
        {dir && <span className={styles['file-dir']}>{dir}</span>}
        <span className={styles['match-count']}>{result.matches.length}</span>
      </Button>

      {expanded && (
        <div className={styles.lines}>
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
