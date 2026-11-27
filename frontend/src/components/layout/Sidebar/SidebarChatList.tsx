import type { ReactNode } from 'react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import { clearSidebarFilters, type SidebarFilters } from '@/store/sidebarFilters';
import type { Chat } from '@/types/chat.types';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import type { ListLoadState } from '@/hooks/queries/listLoad';
import { SidebarChatRow, type ChatRowProps } from './SidebarChatRow';
import { SidebarFilterMenu } from './SidebarFilterMenu';
import { LoadErrorState } from '@/components/ui/shared/LoadErrorState/LoadErrorState';
import { SidebarSectionHeader } from './SidebarSectionHeader';
import type { SidebarChatSection } from './sidebarGrouping';
import styles from './SidebarChatList.module.scss';

interface SidebarChatListProps {
  channels: ReactNode;
  isLoadingChats: boolean;
  threadsLoad: ListLoadState;
  pinnedLoad: ListLoadState;
  recentsLoad: ListLoadState;
  hasAnyContent: boolean;
  pinnedChats: Chat[];
  recentChats: Chat[];
  // What each section renders; Sidebar nests linked channels under exactly these rows
  pinnedRows: Chat[];
  recentRows: Chat[];
  isRecentsCollapsed: boolean;
  hasVisibleContent: boolean;
  recentChatSections: SidebarChatSection[];
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

export function SidebarChatList({
  channels,
  isLoadingChats,
  threadsLoad,
  pinnedLoad,
  recentsLoad,
  hasAnyContent,
  pinnedChats,
  recentChats,
  pinnedRows,
  recentRows,
  isRecentsCollapsed,
  hasVisibleContent,
  recentChatSections,
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
  return (
    <>
      {channels}
      {!hasAnyContent ? (
        threadsLoad.loadFailed ? (
          <div>
            <SidebarSectionHeader title="Threads" />
            <LoadErrorState variant="inline" message="Couldn't load threads" load={threadsLoad} />
          </div>
        ) : isLoadingChats ? null : (
          <div>
            <SidebarSectionHeader title="Threads" />
            <p className={styles.empty}>No threads yet. Start one with New thread.</p>
          </div>
        )
      ) : (
        <div>
          {pinnedChats.length === 0 && pinnedLoad.loadFailed && (
            <div className={styles.section}>
              <SidebarSectionHeader title="Pinned" />
              <LoadErrorState
                variant="inline"
                message="Couldn't load pinned threads"
                load={pinnedLoad}
              />
            </div>
          )}

          {pinnedChats.length > 0 && (
            <div className={styles.section}>
              <SidebarSectionHeader title="Pinned" section="pinned" />
              {pinnedRows.map((chat) => (
                <SidebarChatRow key={chat.id} chat={chat} rowProps={rowProps} />
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
            {isRecentsCollapsed ? (
              recentRows.map((chat) => (
                <SidebarChatRow key={chat.id} chat={chat} rowProps={rowProps} />
              ))
            ) : recentChats.length === 0 && recentsLoad.loadFailed ? (
              <LoadErrorState variant="inline" message="Couldn't load threads" load={recentsLoad} />
            ) : recentChats.length > 0 ? (
              <div>
                {recentChatSections.map((section) => (
                  <div key={section.key} className={section.label ? styles.section : undefined}>
                    {section.label && <div className={styles['group-label']}>{section.label}</div>}
                    {section.chats.map((chat) => (
                      <SidebarChatRow key={chat.id} chat={chat} rowProps={rowProps} />
                    ))}
                  </div>
                ))}
              </div>
            ) : !hasVisibleContent ? (
              // Filters only narrow loaded pages — Show more may still surface matches.
              <div className={styles['no-match']}>
                <p className={styles['no-match-text']}>No chats match the current filters</p>
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
      )}
    </>
  );
}
