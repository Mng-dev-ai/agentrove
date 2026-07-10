import { memo, useCallback, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { CaseSensitive, Loader2, Regex, Search, WholeWord, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { Input } from '@/components/ui/primitives/Input/Input';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useSearchInFilesQuery } from '@/hooks/queries/useSandboxQueries';
import type { SearchParams } from '@/types/sandbox.types';
import { SearchResultGroup } from './SearchResultGroup';
import styles from './SearchPanel.module.scss';

export interface SearchPanelProps {
  sandboxId: string | undefined;
  cwd?: string;
  onOpenResult: (path: string, lineNumber: number) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

type ToggleKey = 'caseSensitive' | 'wholeWord' | 'regex';

const TOGGLES: { key: ToggleKey; icon: LucideIcon; label: string }[] = [
  { key: 'caseSensitive', icon: CaseSensitive, label: 'Match case' },
  { key: 'wholeWord', icon: WholeWord, label: 'Match whole word' },
  { key: 'regex', icon: Regex, label: 'Use regular expression' },
];

export const SearchPanel = memo(function SearchPanel({
  sandboxId,
  cwd,
  onOpenResult,
  inputRef,
}: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);
  const [toggles, setToggles] = useState<Record<ToggleKey, boolean>>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const [activeLine, setActiveLine] = useState<{ path: string; line: number } | null>(null);
  const localInputRef = useRef<HTMLInputElement>(null);
  const activeInputRef = inputRef ?? localInputRef;

  useMountEffect(() => {
    activeInputRef.current?.focus();
  });

  const handleOpen = useCallback(
    (path: string, lineNumber: number) => {
      setActiveLine({ path, line: lineNumber });
      onOpenResult(path, lineNumber);
    },
    [onOpenResult],
  );

  const params: SearchParams = useMemo(
    () => ({
      query: debouncedQuery,
      cwd,
      caseSensitive: toggles.caseSensitive,
      regex: toggles.regex,
      wholeWord: toggles.wholeWord,
    }),
    [debouncedQuery, cwd, toggles.caseSensitive, toggles.regex, toggles.wholeWord],
  );

  const { data, isFetching, error } = useSearchInFilesQuery(sandboxId, params);

  const totalMatches = useMemo(
    () => (data?.results ?? []).reduce((acc, r) => acc + r.matches.length, 0),
    [data],
  );

  const toggle = useCallback((key: ToggleKey) => {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleClear = useCallback(() => {
    setQuery('');
    activeInputRef.current?.focus();
  }, [activeInputRef]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape' && query) {
        e.preventDefault();
        handleClear();
      }
    },
    [query, handleClear],
  );

  const hasQuery = debouncedQuery.trim().length >= 2;
  const hasResults = !!data && data.results.length > 0;

  return (
    <div className={styles['search-panel']}>
      <div className={styles.header}>
        <div role="search" className={styles['search-box']}>
          <Search className={styles['search-icon']} />
          <Input
            ref={activeInputRef}
            variant="unstyled"
            type="text"
            role="searchbox"
            aria-label="Search in files"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className={styles['search-input']}
          />
          <div className={styles.toggles}>
            {TOGGLES.map(({ key, icon: Icon, label }) => (
              <FloatingTooltip key={key} content={label} className={styles['tooltip-trigger']}>
                <Button
                  onClick={() => toggle(key)}
                  variant="unstyled"
                  aria-label={label}
                  aria-pressed={toggles[key]}
                  className={clsx(
                    styles['toggle-button'],
                    toggles[key] && styles['toggle-button--active'],
                  )}
                >
                  <Icon className={styles['toggle-icon']} />
                </Button>
              </FloatingTooltip>
            ))}
            {query && (
              <FloatingTooltip content="Clear search" className={styles['tooltip-trigger']}>
                <Button
                  onClick={handleClear}
                  variant="unstyled"
                  aria-label="Clear search"
                  className={styles['toggle-button']}
                >
                  <X className={styles['toggle-icon']} />
                </Button>
              </FloatingTooltip>
            )}
          </div>
        </div>
      </div>

      <div className={styles.results}>
        {!hasQuery && (
          <p className={styles['empty-message']}>Type at least 2 characters to search.</p>
        )}

        {hasQuery && isFetching && !data && (
          <div className={styles['loading-message']}>
            <Loader2 className={styles['spin-icon']} />
            Searching...
          </div>
        )}

        {hasQuery && error && (
          <p className={styles['error-message']}>
            {error instanceof Error ? error.message : 'Search failed'}
          </p>
        )}

        {hasQuery && data && !hasResults && !isFetching && (
          <p className={styles['empty-message']}>No results for &ldquo;{debouncedQuery}&rdquo;</p>
        )}

        {hasResults && (
          <>
            <p className={styles.summary}>
              {isFetching && <Loader2 className={styles['spin-icon']} />}
              <span>
                {totalMatches} {totalMatches === 1 ? 'result' : 'results'} in {data.results.length}{' '}
                {data.results.length === 1 ? 'file' : 'files'}
                {data.truncated && ' (truncated)'}
              </span>
            </p>
            {/* Disable interaction and dim the list while a new query is in
                flight — keepPreviousData keeps the old results rendered, and
                without this the user could click a stale row and jump to the
                wrong file/line under the updated query. */}
            <div aria-busy={isFetching} className={styles['result-list']}>
              {data.results.map((result) => (
                <SearchResultGroup
                  key={result.path}
                  result={result}
                  onOpen={handleOpen}
                  activeLine={activeLine}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
});
