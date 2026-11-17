import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { Input } from '@/components/ui/primitives/Input/Input';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useSearchChatsQuery } from '@/hooks/queries/useChatQueries';
import { useSearchMachineChatsQueries } from '@/hooks/queries/useMachineQueries';
import { machineName, useOnlineRemoteMachineIds } from '@/store/machineStore';
import { ChatSearchResultGroup } from './ChatSearchResultGroup';
import { hitKey, type SearchHit } from './searchHit';
import styles from './ChatSearchPanel.module.scss';

const LIST_ID = 'chat-search-results';

export interface ChatSearchPanelProps {
  onOpenChat: (chatId: string) => void;
  onOpenChannel: (channelId: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

interface WorkspaceGroup {
  workspaceId: string;
  workspaceName: string;
  hits: SearchHit[];
}

interface ResultRow {
  hit: SearchHit;
  key: string;
  expanded: boolean;
  firstOption: number;
}

interface WorkspaceRows {
  workspaceId: string;
  workspaceName: string;
  rows: ResultRow[];
}

function groupByWorkspace(hits: SearchHit[]): WorkspaceGroup[] {
  const groups = new Map<string, WorkspaceGroup>();
  for (const hit of hits) {
    let group = groups.get(hit.result.workspace_id);
    if (!group) {
      group = {
        workspaceId: hit.result.workspace_id,
        workspaceName: hit.result.workspace_name,
        hits: [],
      };
      groups.set(hit.result.workspace_id, group);
    }
    group.hits.push(hit);
  }
  return Array.from(groups.values());
}

// One option per visible match line, in render order.
function buildResultRows(
  groups: WorkspaceGroup[],
  collapsed: ReadonlySet<string>,
): { workspaces: WorkspaceRows[]; optionHits: SearchHit[] } {
  const optionHits: SearchHit[] = [];
  const workspaces = groups.map((group) => ({
    workspaceId: group.workspaceId,
    workspaceName: group.workspaceName,
    rows: group.hits.map((hit): ResultRow => {
      const key = hitKey(hit);
      const expanded = !collapsed.has(key);
      const row = { hit, key, expanded, firstOption: optionHits.length };
      if (expanded) optionHits.push(...hit.result.matches.map(() => hit));
      return row;
    }),
  }));
  return { workspaces, optionHits };
}

export const ChatSearchPanel = memo(function ChatSearchPanel({
  onOpenChat,
  onOpenChannel,
  inputRef,
}: ChatSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const activeItemRef = useRef<HTMLButtonElement>(null);
  const debouncedQuery = useDebouncedValue(query, 250);
  const localInputRef = useRef<HTMLInputElement>(null);
  const activeInputRef = inputRef ?? localInputRef;

  useMountEffect(() => {
    activeInputRef.current?.focus();
  });

  // Each machine is a separate backend — search all online ones and merge, like
  // the sidebar's merged lists. Each source errors independently so a down
  // machine doesn't take local search with it.
  const local = useSearchChatsQuery(debouncedQuery);
  const remoteIds = useOnlineRemoteMachineIds();
  const remote = useSearchMachineChatsQueries(remoteIds, debouncedQuery);
  const sources = [local, ...remote];
  const isFetching = sources.some((source) => source.isFetching);
  const hasLoaded = sources.some((source) => !!source.data);
  const error = sources.find((source) => source.error)?.error ?? null;
  const truncated = sources.some(
    (source) => !!source.data?.truncated || !!source.data?.channel_truncated,
  );
  const failedSources = [
    local.error ? 'local' : null,
    ...remote.map((source, index) => (source.error ? machineName(remoteIds[index]) : null)),
  ].filter((name): name is string => !!name);

  const handleClear = useCallback(() => {
    setQuery('');
    setActiveIndex(0);
    activeInputRef.current?.focus();
  }, [activeInputRef]);

  const openHit = useCallback(
    (hit: SearchHit) =>
      hit.kind === 'channel'
        ? onOpenChannel(hit.result.channel_id)
        : onOpenChat(hit.result.chat_id),
    [onOpenChat, onOpenChannel],
  );

  const toggleHit = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const results = sources.flatMap((source) => source.data?.results ?? []);
  const channelResults = sources.flatMap((source) => source.data?.channel_results ?? []);
  const { workspaces, optionHits: visibleOptionHits } = buildResultRows(
    groupByWorkspace([
      ...results.map((result): SearchHit => ({ kind: 'chat', result })),
      ...channelResults.map((result): SearchHit => ({ kind: 'channel', result })),
    ]),
    collapsed,
  );
  const totalMatches = [...results, ...channelResults].reduce((acc, r) => acc + r.match_count, 0);
  const resultCount = results.length;
  const channelCount = channelResults.length;
  const scopeLabel = [
    resultCount > 0 || channelCount === 0
      ? `${resultCount} ${resultCount === 1 ? 'chat' : 'chats'}`
      : null,
    channelCount > 0 ? `${channelCount} ${channelCount === 1 ? 'channel' : 'channels'}` : null,
  ]
    .filter(Boolean)
    .join(' and ');

  const hasQuery = debouncedQuery.trim().length >= 2;
  const hasResults = resultCount + channelCount > 0;

  const optionHits = hasQuery ? visibleOptionHits : [];
  const activeOption = Math.min(activeIndex, optionHits.length - 1);

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeOption]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Keys during IME composition belong to the candidate window
    if (e.nativeEvent.isComposing) return;
    const count = optionHits.length;
    if (e.key === 'Escape' && query) {
      e.preventDefault();
      handleClear();
    } else if (e.key === 'ArrowDown' && count > 0) {
      e.preventDefault();
      setActiveIndex((activeOption + 1) % count);
    } else if (e.key === 'ArrowUp' && count > 0) {
      e.preventDefault();
      setActiveIndex((activeOption - 1 + count) % count);
    } else if (e.key === 'Enter' && activeOption >= 0) {
      e.preventDefault();
      openHit(optionHits[activeOption]);
    }
  };

  return (
    <div className={styles['chat-search-panel']}>
      <div className={styles.header}>
        <div role="search" className={styles['search-box']}>
          <Search className={styles['search-icon']} />
          <Input
            ref={activeInputRef}
            variant="unstyled"
            type="text"
            role="combobox"
            aria-expanded={optionHits.length > 0}
            aria-controls={LIST_ID}
            aria-activedescendant={
              activeOption >= 0 ? `chat-search-option-${activeOption}` : undefined
            }
            aria-label="Search in chats"
            placeholder="Search chats"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
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
            {failedSources.join(' and ')} search failed — results may be incomplete.
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
                {totalMatches} {totalMatches === 1 ? 'result' : 'results'} in {scopeLabel} ·{' '}
                {workspaces.length} {workspaces.length === 1 ? 'workspace' : 'workspaces'}
                {truncated && ' (truncated)'}
              </span>
            </p>
            <div
              aria-busy={isFetching}
              role="listbox"
              id={LIST_ID}
              className={styles['result-list']}
            >
              {workspaces.map((workspace) => (
                <div key={workspace.workspaceId} className={styles['workspace-group']}>
                  <p className={styles['workspace-name']}>{workspace.workspaceName}</p>
                  {workspace.rows.map((row) => (
                    <ChatSearchResultGroup
                      key={row.key}
                      hit={row.hit}
                      expanded={row.expanded}
                      onToggle={toggleHit}
                      onOpen={openHit}
                      firstOption={row.firstOption}
                      activeOption={activeOption}
                      activeItemRef={activeItemRef}
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
