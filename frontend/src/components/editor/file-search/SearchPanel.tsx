import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaseSensitive, Loader2, Regex, Search, WholeWord, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { Input } from '@/components/ui/primitives/Input';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useSearchInFilesQuery } from '@/hooks/queries/useSandboxQueries';
import type { SearchParams } from '@/types/sandbox.types';
import { cn } from '@/utils/cn';
import { SearchResultGroup } from './SearchResultGroup';

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
  const [debouncedQuery, setDebouncedQuery] = useState('');
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

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

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
    setDebouncedQuery('');
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
    <div className="flex h-full flex-col">
      <div className="flex flex-none flex-col gap-2 border-b border-border/50 px-3 py-2 dark:border-border-dark/50">
        <div
          role="search"
          className="relative flex items-center rounded-md border border-border/50 bg-surface dark:border-border-dark/50 dark:bg-surface-dark"
        >
          <Search className="pointer-events-none absolute left-2 h-3 w-3 text-text-quaternary dark:text-text-dark-quaternary" />
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
            className={cn(
              'h-7 w-full border-none bg-transparent py-1 pl-7 pr-2 text-xs',
              'text-text-primary dark:text-text-dark-primary',
              'placeholder:text-text-quaternary dark:placeholder:text-text-dark-quaternary',
              'focus:outline-none',
            )}
          />
          <div className="flex items-center gap-0.5 pr-1">
            {TOGGLES.map(({ key, icon: Icon, label }) => (
              <FloatingTooltip key={key} content={label} className="flex">
                <Button
                  onClick={() => toggle(key)}
                  variant="unstyled"
                  aria-label={label}
                  aria-pressed={toggles[key]}
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded transition-colors',
                    toggles[key]
                      ? 'bg-surface-active text-text-primary dark:bg-surface-dark-active dark:text-text-dark-primary'
                      : 'text-text-quaternary hover:text-text-primary dark:text-text-dark-quaternary dark:hover:text-text-dark-primary',
                  )}
                >
                  <Icon className="h-3 w-3" />
                </Button>
              </FloatingTooltip>
            ))}
            {query && (
              <FloatingTooltip content="Clear search" className="flex">
                <Button
                  onClick={handleClear}
                  variant="unstyled"
                  aria-label="Clear search"
                  className="flex h-5 w-5 items-center justify-center rounded text-text-quaternary transition-colors hover:text-text-primary dark:text-text-dark-quaternary dark:hover:text-text-dark-primary"
                >
                  <X className="h-3 w-3" />
                </Button>
              </FloatingTooltip>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-6 pt-1">
        {!hasQuery && (
          <p className="px-2 py-6 text-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
            Type at least 2 characters to search.
          </p>
        )}

        {hasQuery && isFetching && !data && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-text-quaternary dark:text-text-dark-quaternary">
            <Loader2 className="h-3 w-3 animate-spin" />
            Searching...
          </div>
        )}

        {hasQuery && error && (
          <p className="px-2 py-4 text-xs text-error-500 dark:text-error-400">
            {error instanceof Error ? error.message : 'Search failed'}
          </p>
        )}

        {hasQuery && data && !hasResults && !isFetching && (
          <p className="px-2 py-6 text-center text-xs text-text-quaternary dark:text-text-dark-quaternary">
            No results for &ldquo;{debouncedQuery}&rdquo;
          </p>
        )}

        {hasResults && (
          <>
            <p className="flex items-center gap-2 px-2 pb-2 pt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
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
            <div
              aria-busy={isFetching}
              className={cn(
                'flex flex-col gap-0.5 transition-opacity duration-150',
                isFetching && 'pointer-events-none opacity-50',
              )}
            >
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
