import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { Input } from '@/components/ui/primitives/Input/Input';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useSearchChatsQuery } from '@/hooks/queries/useChatQueries';
import { useSearchCloudChatsQuery } from '@/hooks/queries/useCloudQueries';
import type { ChatSearchResult } from '@/types/chat.types';
import { ChatSearchResultGroup } from './ChatSearchResultGroup';
import styles from './ChatSearchPanel.module.scss';

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
  const debouncedQuery = useDebouncedValue(query, 250);
  const localInputRef = useRef<HTMLInputElement>(null);
  const activeInputRef = inputRef ?? localInputRef;

  useMountEffect(() => {
    activeInputRef.current?.focus();
  });

  // Local and cloud chats live on separate backends — search both and merge,
  // like the sidebar's merged lists. Each source errors independently so a
  // down VPS doesn't take local search with it.
  const local = useSearchChatsQuery(debouncedQuery);
  const cloud = useSearchCloudChatsQuery(debouncedQuery);
  const isFetching = local.isFetching || cloud.isFetching;
  const hasLoaded = !!local.data || !!cloud.data;
  const error = local.error ?? cloud.error;
  const truncated = !!local.data?.truncated || !!cloud.data?.truncated;

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

  const { grouped, totalMatches, resultCount } = useMemo(() => {
    const results = [...(local.data?.results ?? []), ...(cloud.data?.results ?? [])];
    return {
      grouped: groupByWorkspace(results),
      totalMatches: results.reduce((acc, r) => acc + r.match_count, 0),
      resultCount: results.length,
    };
  }, [local.data, cloud.data]);

  const hasQuery = debouncedQuery.trim().length >= 2;
  const hasResults = resultCount > 0;

  return (
    <div className={styles['chat-search-panel']}>
      <div className={styles.header}>
        <div role="search" className={styles['search-box']}>
          <Search className={styles['search-icon']} />
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
            className={styles['search-input']}
          />
          {query && (
            <FloatingTooltip content="Clear search" className={styles['tooltip-trigger']}>
              <Button
                onClick={handleClear}
                variant="unstyled"
                aria-label="Clear search"
                className={styles['search-clear']}
              >
                <X className={styles['clear-icon']} />
              </Button>
            </FloatingTooltip>
          )}
        </div>
      </div>

      <div className={styles.results}>
        {!hasQuery && (
          <p className={styles['empty-message']}>Type at least 2 characters to search.</p>
        )}

        {/* Keep the spinner until something is showable — one source settling
            empty while the other is still in flight must not blank the panel. */}
        {hasQuery && isFetching && !hasResults && (
          <div className={styles['loading-message']}>
            <Loader2 className={styles['spin-icon']} />
            Searching...
          </div>
        )}

        {/* Blocking failure means neither source returned and nothing is still
            in flight — a source that's still fetching gets its chance first.
            Once anything loaded, a failed source degrades to a non-blocking
            incompleteness notice, coherent alongside results or "No results". */}
        {hasQuery && error && !hasLoaded && !isFetching && (
          <p className={styles['error-message']}>
            {error instanceof Error ? error.message : 'Search failed'}
          </p>
        )}

        {hasQuery && error && hasLoaded && (
          <p className={styles['error-message']}>
            {[local.error && 'local', cloud.error && 'cloud'].filter(Boolean).join(' and ')} search
            failed — results may be incomplete.
          </p>
        )}

        {hasQuery && hasLoaded && !hasResults && !isFetching && (
          <p className={styles['empty-message']}>No results for &ldquo;{debouncedQuery}&rdquo;</p>
        )}

        {hasQuery && hasResults && (
          <>
            <p className={styles.summary}>
              {isFetching && <Loader2 className={styles['spin-icon']} />}
              <span>
                {totalMatches} {totalMatches === 1 ? 'result' : 'results'} in {resultCount}{' '}
                {resultCount === 1 ? 'chat' : 'chats'} · {grouped.length}{' '}
                {grouped.length === 1 ? 'workspace' : 'workspaces'}
                {truncated && ' (truncated)'}
              </span>
            </p>
            <div aria-busy={isFetching} className={styles['result-list']}>
              {grouped.map((group) => (
                <div key={group.workspaceId} className={styles['workspace-group']}>
                  <p className={styles['workspace-name']}>{group.workspaceName}</p>
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
