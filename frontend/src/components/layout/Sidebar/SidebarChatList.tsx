import { type ReactNode, type Ref } from 'react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import { clearSidebarFilters, type SidebarFilters } from '@/store/sidebarFilters';
import type { Chat } from '@/types/chat.types';
import type { WorkspaceBadge } from '@/hooks/queries/useSidebarChatLists';
import { useUIStore } from '@/store/uiStore';
import { SidebarChatRow, type ChatRowProps } from './SidebarChatRow';
import { SidebarFilterMenu } from './SidebarFilterMenu';
import { SidebarSectionHeader } from './SidebarSectionHeader';
import type { SidebarChatSection } from './sidebarGrouping';
import styles from './SidebarChatList.module.scss';

interface SidebarChatListProps {
  scrollContainerRef: Ref<HTMLDivElement>;
  channels: ReactNode;
  isLoadingChats: boolean;
  hasAnyContent: boolean;
  needsYouChats: Chat[];
  pinnedChats: Chat[];
  recentChats: Chat[];
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
}

export function SidebarChatList({
  scrollContainerRef,
  channels,
  isLoadingChats,
  hasAnyContent,
  needsYouChats,
  pinnedChats,
  recentChats,
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
}: SidebarChatListProps) {
  const collapsedSections = useUIStore((state) => state.collapsedSidebarSections);
  const isPinnedCollapsed = collapsedSections.includes('pinned');
  const isRecentsCollapsed = collapsedSections.includes('recents');
  // Workspace group labels already name the workspace; pinned chats have no such header
  // A collapsed section still shows its open chats, so the current selection never disappears
  const isOpenChat = (chat: Chat) =>
    chat.id === rowProps.selectedChatId || rowProps.splitChatIds.includes(chat.id);
  const recentRowProps =
    filters.groupBy === 'workspace' ? { ...rowProps, showWorkspaceBadges: false } : rowProps;
  return (
    <div ref={scrollContainerRef} className={styles.scroll}>
      {channels}
      {!hasAnyContent ? (
        isLoadingChats ? null : (
          <div>
            <SidebarSectionHeader title="Threads" />
            <p className={styles.empty}>No threads yet. Start one with New thread.</p>
          </div>
        )
      ) : (
        <div>
          {needsYouChats.length > 0 && (
            // Not collapsible: hiding what's blocked on you defeats the group.
            <div className={styles.section}>
              <SidebarSectionHeader title="Needs you" />
              {needsYouChats.map((chat) => (
                <SidebarChatRow key={chat.id} chat={chat} rowProps={rowProps} />
              ))}
            </div>
          )}

          {pinnedChats.length > 0 && (
            <div className={styles.section}>
              <SidebarSectionHeader title="Pinned" section="pinned" />
              {(isPinnedCollapsed ? pinnedChats.filter(isOpenChat) : pinnedChats).map((chat) => (
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
              recentChats
                .filter(isOpenChat)
                .map((chat) => (
                  <SidebarChatRow key={chat.id} chat={chat} rowProps={recentRowProps} />
                ))
            ) : recentChats.length > 0 ? (
              <div>
                {recentChatSections.map((section) => (
                  <div key={section.key} className={section.label ? styles.section : undefined}>
                    {section.label && <div className={styles['group-label']}>{section.label}</div>}
                    {section.chats.map((chat) => (
                      <SidebarChatRow key={chat.id} chat={chat} rowProps={recentRowProps} />
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
          {/* Outside Recents: a remote page of only pinned chats still needs Load more. */}
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
