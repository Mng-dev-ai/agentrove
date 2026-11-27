import { Button } from '@/components/ui/primitives/Button/Button';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import { clearSidebarFilters, type SidebarFilters } from '@/store/sidebarFilters';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import type { ListLoadState } from '@/hooks/queries/listLoad';
import { SidebarChannelRow, SidebarChatRow, type ChatRowProps } from './SidebarChatRow';
import { SidebarFilterMenu } from './SidebarFilterMenu';
import { LoadErrorState } from '@/components/ui/shared/LoadErrorState/LoadErrorState';
import { SidebarSectionHeader } from './SidebarSectionHeader';
import type { SidebarSection, SidebarThread } from './sidebarGrouping';
import styles from './SidebarChatList.module.scss';

interface SidebarChatListProps {
  isLoading: boolean;
  threadsLoad: ListLoadState;
  pinnedLoad: ListLoadState;
  recentsLoad: ListLoadState;
  channelsLoad: ListLoadState;
  hasAnyContent: boolean;
  hasChannels: boolean;
  // Whether each section has threads matching the filters, collapsed or not
  hasPinned: boolean;
  hasRecents: boolean;
  // What each section renders; Sidebar nests linked channels under exactly these rows
  pinnedRows: SidebarThread[];
  recentRows: SidebarThread[];
  isRecentsCollapsed: boolean;
  hasVisibleContent: boolean;
  recentSections: SidebarSection[];
  rowProps: ChatRowProps;
  filters: SidebarFilters;
  onChangeFilters: (filters: SidebarFilters) => void;
  workspaceBadgeById: Map<string, WorkspaceBadge>;
  machineOptions: { id: string; name: string }[];
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadMore: () => void;
  canShowLess: boolean;
  onShowLess: () => void;
}

function SidebarThreadRow({ thread, rowProps }: { thread: SidebarThread; rowProps: ChatRowProps }) {
  return thread.kind === 'chat' ? (
    <SidebarChatRow chat={thread.chat} rowProps={rowProps} />
  ) : (
    <SidebarChannelRow entry={thread} rowProps={rowProps} />
  );
}

const rowKey = (thread: SidebarThread) =>
  thread.kind === 'chat' ? `chat:${thread.chat.id}` : `channel:${thread.channel.id}`;

export function SidebarChatList({
  isLoading,
  threadsLoad,
  pinnedLoad,
  recentsLoad,
  channelsLoad,
  hasAnyContent,
  hasChannels,
  hasPinned,
  hasRecents,
  pinnedRows,
  recentRows,
  isRecentsCollapsed,
  hasVisibleContent,
  recentSections,
  rowProps,
  filters,
  onChangeFilters,
  workspaceBadgeById,
  machineOptions,
  hasMore,
  isFetchingMore,
  onLoadMore,
  canShowLess,
  onShowLess,
}: SidebarChatListProps) {
  const channelsError = !hasChannels && channelsLoad.loadFailed && (
    <LoadErrorState variant="inline" message="Couldn't load channels" load={channelsLoad} />
  );

  if (!hasAnyContent) {
    if (isLoading) return null;
    return (
      <div>
        <SidebarSectionHeader title="Threads" />
        {threadsLoad.loadFailed ? (
          <LoadErrorState variant="inline" message="Couldn't load threads" load={threadsLoad} />
        ) : (
          !channelsLoad.loadFailed && <p className={styles.empty}>No threads yet</p>
        )}
        {channelsError}
      </div>
    );
  }

  return (
    <div>
      {!hasPinned && pinnedLoad.loadFailed && (
        <div className={styles.section}>
          <SidebarSectionHeader title="Pinned" />
          <LoadErrorState
            variant="inline"
            message="Couldn't load pinned threads"
            load={pinnedLoad}
          />
        </div>
      )}

      {hasPinned && (
        <div className={styles.section}>
          <SidebarSectionHeader title="Pinned" section="pinned" />
          {pinnedRows.map((thread) => (
            <SidebarThreadRow key={rowKey(thread)} thread={thread} rowProps={rowProps} />
          ))}
        </div>
      )}

      {/* Header always renders so the filter menu stays reachable when filters empty the list. */}
      <div>
        <SidebarSectionHeader title="Recents" section="recents">
          <SidebarFilterMenu
            filters={filters}
            onChange={onChangeFilters}
            workspaceBadgeById={workspaceBadgeById}
            machineOptions={machineOptions}
          />
        </SidebarSectionHeader>
        {channelsError}
        {isRecentsCollapsed ? (
          recentRows.map((thread) => (
            <SidebarThreadRow key={rowKey(thread)} thread={thread} rowProps={rowProps} />
          ))
        ) : !hasRecents && recentsLoad.loadFailed ? (
          <LoadErrorState variant="inline" message="Couldn't load threads" load={recentsLoad} />
        ) : hasRecents ? (
          <div>
            {recentSections.map((section) => (
              <div key={section.key} className={section.label ? styles.section : undefined}>
                {section.label && <div className={styles['group-label']}>{section.label}</div>}
                {section.threads.map((thread) => (
                  <SidebarThreadRow key={rowKey(thread)} thread={thread} rowProps={rowProps} />
                ))}
              </div>
            ))}
          </div>
        ) : !hasVisibleContent ? (
          // Filters only narrow loaded pages — Show more may still surface matches.
          <div className={styles['no-match']}>
            <p className={styles['no-match-text']}>No threads match the current filters</p>
            <Button
              variant="unstyled"
              onClick={() => onChangeFilters(clearSidebarFilters(filters))}
              className={styles['clear-filters']}
            >
              Clear filters
            </Button>
          </div>
        ) : null}
      </div>
      {/* Outside Recents: a remote page of only pinned chats still needs Show more. */}
      {(hasMore || canShowLess) && (
        <div className={styles['more-toggles']}>
          {hasMore && (
            <Button
              variant="unstyled"
              type="button"
              onClick={onLoadMore}
              disabled={isFetchingMore}
              className={styles['more-toggle']}
            >
              {isFetchingMore ? (
                <>
                  <Spinner size="xs" />
                  Loading…
                </>
              ) : (
                'Show more'
              )}
            </Button>
          )}
          {canShowLess && (
            <Button
              variant="unstyled"
              type="button"
              onClick={onShowLess}
              className={styles['more-toggle']}
            >
              Show less
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
