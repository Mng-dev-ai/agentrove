import { type Ref } from 'react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import { clearSidebarFilters, type SidebarFilters } from '@/store/sidebarFilters';
import type { Chat } from '@/types/chat.types';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import { SidebarChatRow, type ChatRowProps } from './SidebarChatRow';
import { SidebarFilterMenu } from './SidebarFilterMenu';
import type { SidebarChatSection } from './sidebarGrouping';
import styles from './SidebarChatList.module.scss';

interface SidebarChatListProps {
  scrollContainerRef: Ref<HTMLDivElement>;
  isLoadingChats: boolean;
  hasAnyContent: boolean;
  visiblePinnedChats: Chat[];
  visibleRecentChats: Chat[];
  hasVisibleContent: boolean;
  recentChatSections: SidebarChatSection[];
  rowProps: ChatRowProps;
  filters: SidebarFilters;
  onChangeFilters: (filters: SidebarFilters) => void;
  workspaceBadgeById: Map<string, WorkspaceBadge>;
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadMore: () => void;
}

export function SidebarChatList({
  scrollContainerRef,
  isLoadingChats,
  hasAnyContent,
  visiblePinnedChats,
  visibleRecentChats,
  hasVisibleContent,
  recentChatSections,
  rowProps,
  filters,
  onChangeFilters,
  workspaceBadgeById,
  hasMore,
  isFetchingMore,
  onLoadMore,
}: SidebarChatListProps) {
  return (
    <div ref={scrollContainerRef} className={styles.scroll}>
      {!hasAnyContent ? (
        isLoadingChats ? null : (
          <p className={styles.empty}>No chats yet</p>
        )
      ) : (
        <div>
          {visiblePinnedChats.length > 0 && (
            <div className={styles.section}>
              <div className={styles['section-header']}>
                <span className={styles['section-title']}>Pinned</span>
              </div>
              <div>
                {visiblePinnedChats.map((chat) => (
                  <SidebarChatRow key={chat.id} chat={chat} rowProps={rowProps} />
                ))}
              </div>
            </div>
          )}

          {/* Header always renders so the filter menu stays reachable when filters empty the list. */}
          <div>
            <div className={styles['recents-header']}>
              <span className={styles['section-title']}>Recents</span>
              <SidebarFilterMenu
                filters={filters}
                onChange={onChangeFilters}
                workspaceBadgeById={workspaceBadgeById}
              />
            </div>
            {visibleRecentChats.length > 0 ? (
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
              // Filters only narrow loaded pages — Load more may still surface matches.
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
          {/* Outside Recents: a cloud page of only pinned chats still needs Load more. */}
          {hasMore && (
            <Button
              variant="unstyled"
              type="button"
              onClick={onLoadMore}
              disabled={isFetchingMore}
              className={styles['load-more']}
            >
              {isFetchingMore ? (
                <>
                  <Spinner size="xs" />
                  Loading…
                </>
              ) : (
                'Load more'
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
