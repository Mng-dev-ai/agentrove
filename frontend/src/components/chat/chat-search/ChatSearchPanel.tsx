import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { Input } from '@/components/ui/primitives/Input';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useSearchChatsQuery } from '@/hooks/queries/useChatQueries';
import type { ChatSearchResult } from '@/types/chat.types';
import { cn } from '@/utils/cn';
import { ChatSearchResultGroup } from './ChatSearchResultGroup';

export interface ChatSearchPanelProps {
  onOpenChat: (chatId: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

interface WorkspaceGroup {
  workspaceId: string;
  workspaceName: string;
  results: ChatSearchResult[];
}

function groupByWorkspace(results: ChatSearchResult[]): WorkspaceGroup[] {
  const groups = new Map<string, WorkspaceGroup>();
  for (const result of results) {
    let group = groups.get(result.workspace_id);
    if (!group) {
      group = {
        workspaceId: result.workspace_id,
        workspaceName: result.workspace_name,
        results: [],
      };
      groups.set(result.workspace_id, group);
    }
    group.results.push(result);
  }
  return Array.from(groups.values());
}

export const ChatSearchPanel = memo(function ChatSearchPanel({
  onOpenChat,
  inputRef,
}: ChatSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const localInputRef = useRef<HTMLInputElement>(null);
  const activeInputRef = inputRef ?? localInputRef;

  useMountEffect(() => {
    activeInputRef.current?.focus();
  });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isFetching, error } = useSearchChatsQuery(debouncedQuery);

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

  const { grouped, totalMatches } = useMemo(() => {
    const results = data?.results ?? [];
    return {
      grouped: groupByWorkspace(results),
      totalMatches: results.reduce((acc, r) => acc + r.match_count, 0),
    };
  }, [data]);

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
            aria-label="Search in chats"
            placeholder="Search chats"
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
          {query && (
            <FloatingTooltip content="Clear search" className="flex">
              <Button
                onClick={handleClear}
                variant="unstyled"
                aria-label="Clear search"
                className="mr-1 flex h-5 w-5 items-center justify-center rounded text-text-quaternary transition-colors hover:text-text-primary dark:text-text-dark-quaternary dark:hover:text-text-dark-primary"
              >
                <X className="h-3 w-3" />
              </Button>
            </FloatingTooltip>
          )}
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

        {hasQuery && hasResults && (
          <>
            <p className="flex items-center gap-2 px-2 pb-2 pt-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
              <span>
                {totalMatches} {totalMatches === 1 ? 'result' : 'results'} in {data.results.length}{' '}
                {data.results.length === 1 ? 'chat' : 'chats'} · {grouped.length}{' '}
                {grouped.length === 1 ? 'workspace' : 'workspaces'}
                {data.truncated && ' (truncated)'}
              </span>
            </p>
            <div
              aria-busy={isFetching}
              className={cn(
                'flex flex-col gap-0.5 transition-opacity duration-150',
                isFetching && 'pointer-events-none opacity-50',
              )}
            >
              {grouped.map((group) => (
                <div key={group.workspaceId} className="mt-2 first:mt-0">
                  <p className="px-1.5 pb-1 pt-1 text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
                    {group.workspaceName}
                  </p>
                  {group.results.map((result) => (
                    <ChatSearchResultGroup
                      key={result.chat_id}
                      result={result}
                      onOpen={onOpenChat}
                    />
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
});
