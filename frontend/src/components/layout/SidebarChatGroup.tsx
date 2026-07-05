import { useState, useMemo, useCallback, memo } from 'react';
import type { InfiniteData } from '@tanstack/react-query';
import { ChevronDown, SquarePen, MoreHorizontal } from 'lucide-react';
import type { Chat } from '@/types/chat.types';
import type { Workspace } from '@/types/workspace.types';
import type { PaginatedChats } from '@/types/api.types';
import { Button } from '@/components/ui/primitives/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { useInfiniteChatsQuery } from '@/hooks/queries/useChatQueries';
import { useInfiniteCloudChatsQuery } from '@/hooks/queries/useCloudQueries';
import { SidebarChatItem } from './SidebarChatItem';
import { SubThreadList } from './SubThreadList';

const CHATS_PER_WORKSPACE = 10;

function flattenChatPages(data: InfiniteData<PaginatedChats> | undefined): Chat[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

interface ChatHoverProps {
  isHovered: boolean;
  onMouseEnter: (chatId: string) => void;
  onMouseLeave: () => void;
}

// Selection + handler bundle every chat row needs, threaded through the group shell
// unchanged. Kept as one object so the shell forwards it instead of re-listing nine props.
interface ChatRowProps {
  selectedChatId: string | null;
  secondaryChatId: string | null;
  dropdownChatId: string | null;
  streamingChatIdSet: Set<string>;
  blockedChatIdSet: Set<string>;
  completedChatIdSet: Set<string>;
  onChatSelect: (chatId: string) => void;
  onOpenInSplit?: (chatId: string) => void;
  onDropdownClick: (e: React.MouseEvent<HTMLButtonElement>, chat: Chat) => void;
  expandedSubThreads: Set<string>;
  onToggleSubThreads: (chatId: string) => void;
}

// One chat row: the item plus its expanded sub-thread list. Local and cloud render
// this identically, so it lives in the shell instead of a per-group render prop.
function SidebarChatRow({
  chat,
  hover,
  rowProps,
}: {
  chat: Chat;
  hover: ChatHoverProps;
  rowProps: ChatRowProps;
}) {
  const {
    selectedChatId,
    secondaryChatId,
    dropdownChatId,
    streamingChatIdSet,
    blockedChatIdSet,
    completedChatIdSet,
    onChatSelect,
    onOpenInSplit,
    onDropdownClick,
    expandedSubThreads,
    onToggleSubThreads,
  } = rowProps;
  const hasSubThreads = chat.sub_thread_count > 0;

  return (
    <div>
      <SidebarChatItem
        chat={chat}
        isSelected={chat.id === selectedChatId}
        isActive={chat.id === selectedChatId || chat.id === secondaryChatId}
        isHovered={hover.isHovered}
        isDropdownOpen={dropdownChatId === chat.id}
        isChatStreaming={streamingChatIdSet.has(chat.id)}
        isChatBlocked={blockedChatIdSet.has(chat.id)}
        isChatCompleted={completedChatIdSet.has(chat.id)}
        onSelect={onChatSelect}
        onOpenInSplit={onOpenInSplit}
        onDropdownClick={onDropdownClick}
        onMouseEnter={hover.onMouseEnter}
        onMouseLeave={hover.onMouseLeave}
        onToggleSubThreads={hasSubThreads ? onToggleSubThreads : undefined}
        isSubThreadsExpanded={hasSubThreads ? expandedSubThreads.has(chat.id) : undefined}
      />
      {hasSubThreads && expandedSubThreads.has(chat.id) && (
        <SubThreadList
          parentChatId={chat.id}
          selectedChatId={selectedChatId}
          secondaryChatId={secondaryChatId}
          onSelect={onChatSelect}
          onDropdownClick={onDropdownClick}
          streamingChatIdSet={streamingChatIdSet}
          blockedChatIdSet={blockedChatIdSet}
          completedChatIdSet={completedChatIdSet}
        />
      )}
    </div>
  );
}

interface ChatGroupProps {
  name: string;
  // Set only for cloud groups, which need disambiguating from local projects of
  // the same name; local groups render no tag.
  originLabel?: 'cloud';
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isLoading: boolean;
  chats: Chat[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  // Workspace identity for the header-action buttons. Both local and cloud groups
  // render the same new-thread + context-menu actions, so the shell owns them.
  workspaceId: string;
  onNewThread: (e: React.MouseEvent, workspaceId: string) => void;
  onWorkspaceContextMenu: (e: React.MouseEvent<HTMLButtonElement>, workspaceId: string) => void;
  rowProps: ChatRowProps;
}

// Shared sidebar group: collapse header (name + optional origin tag + actions),
// loading/empty state, and the show-more / show-less / load-more pagination.
// Owns the per-group hover + expand state so the local and cloud wrappers only
// pick a query hook and fill the slots.
const SidebarChatGroup = memo(function SidebarChatGroup({
  name,
  originLabel,
  isCollapsed,
  onToggleCollapse,
  isLoading,
  chats,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  workspaceId,
  onNewThread,
  onWorkspaceContextMenu,
  rowProps,
}: ChatGroupProps) {
  const [isChatsExpanded, setIsChatsExpanded] = useState(false);
  const [hoveredChatId, setHoveredChatId] = useState<string | null>(null);
  const handleMouseEnter = useCallback((chatId: string) => setHoveredChatId(chatId), []);
  const handleMouseLeave = useCallback(() => setHoveredChatId(null), []);

  const visibleChats = isChatsExpanded ? chats : chats.slice(0, CHATS_PER_WORKSPACE);
  const hasMore = chats.length > CHATS_PER_WORKSPACE;
  const showLoadMore = isChatsExpanded && hasNextPage;

  return (
    <div>
      <div className="group flex items-center gap-1 pb-2 pt-3.5">
        <Button
          variant="unstyled"
          type="button"
          onClick={onToggleCollapse}
          className="min-w-0 flex-1 text-left"
        >
          <span className="text-2xs font-medium uppercase tracking-wider text-text-quaternary transition-colors duration-200 group-hover:text-text-tertiary dark:text-text-dark-quaternary dark:group-hover:text-text-dark-tertiary">
            {name}
          </span>
          {originLabel && (
            <span className="ml-1 text-2xs lowercase text-text-quaternary dark:text-text-dark-quaternary">
              ({originLabel})
            </span>
          )}
        </Button>
        <FloatingTooltip content="New thread" className="flex">
          <Button
            variant="unstyled"
            type="button"
            aria-label="New thread"
            onClick={(e) => onNewThread(e, workspaceId)}
            className="flex shrink-0 items-center justify-center rounded p-0.5 text-text-quaternary opacity-0 transition-all duration-200 hover:text-text-primary group-hover:opacity-100 dark:text-text-dark-quaternary dark:hover:text-text-dark-primary"
          >
            <SquarePen className="h-3 w-3" />
          </Button>
        </FloatingTooltip>
        <Button
          variant="unstyled"
          type="button"
          data-ws-dropdown-trigger
          onClick={(e) => onWorkspaceContextMenu(e, workspaceId)}
          className="flex shrink-0 items-center justify-center rounded p-0.5 text-text-quaternary opacity-0 transition-all duration-200 hover:text-text-primary group-hover:opacity-100 dark:text-text-dark-quaternary dark:hover:text-text-dark-primary"
        >
          <MoreHorizontal className="h-3 w-3" />
        </Button>
      </div>
      {!isCollapsed && (
        <div>
          {isLoading ? null : chats.length === 0 ? (
            <p className="py-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              No threads
            </p>
          ) : (
            <>
              {visibleChats.map((chat) => (
                <SidebarChatRow
                  key={chat.id}
                  chat={chat}
                  hover={{
                    isHovered: hoveredChatId === chat.id,
                    onMouseEnter: handleMouseEnter,
                    onMouseLeave: handleMouseLeave,
                  }}
                  rowProps={rowProps}
                />
              ))}
              {hasMore && !isChatsExpanded && (
                <Button
                  variant="unstyled"
                  type="button"
                  onClick={() => setIsChatsExpanded(true)}
                  className="flex w-full items-center gap-1 py-1.5 text-left text-xs text-text-tertiary transition-colors duration-200 hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
                >
                  Show more ({chats.length - CHATS_PER_WORKSPACE})
                  <ChevronDown className="h-3 w-3" />
                </Button>
              )}
              {(hasMore || showLoadMore) && isChatsExpanded && (
                <div className="flex items-center gap-2 py-1.5">
                  <Button
                    variant="unstyled"
                    type="button"
                    onClick={() => setIsChatsExpanded(false)}
                    className="text-2xs text-text-tertiary transition-colors duration-200 hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
                  >
                    Show less
                  </Button>
                  {showLoadMore && (
                    <Button
                      variant="unstyled"
                      type="button"
                      onClick={onLoadMore}
                      disabled={isFetchingNextPage}
                      className="flex items-center gap-1 text-2xs text-text-tertiary transition-colors duration-200 hover:text-text-primary disabled:opacity-50 dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
                    >
                      {isFetchingNextPage ? (
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
            </>
          )}
        </div>
      )}
    </div>
  );
});

interface WorkspaceGroupProps extends ChatRowProps {
  workspace: Workspace;
  isCollapsed: boolean;
  onToggleCollapse: (workspaceId: string) => void;
  onNewThread: (e: React.MouseEvent, workspaceId: string) => void;
  onWorkspaceContextMenu: (e: React.MouseEvent<HTMLButtonElement>, workspaceId: string) => void;
}

export const SidebarWorkspaceGroup = memo(function SidebarWorkspaceGroup({
  workspace,
  isCollapsed,
  onToggleCollapse,
  onNewThread,
  onWorkspaceContextMenu,
  ...rowProps
}: WorkspaceGroupProps) {
  // Each non-collapsed workspace fires its own query on mount. Collapsing a
  // workspace disables its query. If N simultaneous requests becomes a problem
  // with many workspaces, default new/inactive workspaces to collapsed.
  const { data, hasNextPage, fetchNextPage, isFetchingNextPage, isLoading } = useInfiniteChatsQuery(
    {
      workspaceId: workspace.id,
      pinned: false,
      enabled: !isCollapsed,
    },
  );
  const chats = useMemo(() => flattenChatPages(data), [data]);

  return (
    <SidebarChatGroup
      name={workspace.name}
      isCollapsed={isCollapsed}
      onToggleCollapse={() => onToggleCollapse(workspace.id)}
      isLoading={isLoading}
      chats={chats}
      hasNextPage={!!hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      onLoadMore={() => void fetchNextPage()}
      workspaceId={workspace.id}
      onNewThread={onNewThread}
      onWorkspaceContextMenu={onWorkspaceContextMenu}
      rowProps={rowProps}
    />
  );
});

interface CloudGroupProps extends ChatRowProps {
  workspace: Workspace;
  isCollapsed: boolean;
  onToggleCollapse: (workspaceId: string) => void;
  onNewThread: (e: React.MouseEvent, workspaceId: string) => void;
  onWorkspaceContextMenu: (e: React.MouseEvent<HTMLButtonElement>, workspaceId: string) => void;
}

// A cloud project's chats — same shell and header affordances as local. New-thread
// routes to the landing composer with the cloud target preselected; the context
// menu (rename/delete) proxies to the VPS via the cloud workspace mutations.
export const SidebarCloudGroup = memo(function SidebarCloudGroup({
  workspace,
  isCollapsed,
  onToggleCollapse,
  onNewThread,
  onWorkspaceContextMenu,
  ...rowProps
}: CloudGroupProps) {
  const { data, hasNextPage, fetchNextPage, isFetchingNextPage, isLoading } =
    useInfiniteCloudChatsQuery(workspace.id, !isCollapsed);
  const chats = useMemo(() => flattenChatPages(data), [data]);

  return (
    <SidebarChatGroup
      name={workspace.name}
      originLabel="cloud"
      isCollapsed={isCollapsed}
      onToggleCollapse={() => onToggleCollapse(workspace.id)}
      isLoading={isLoading}
      chats={chats}
      hasNextPage={!!hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      onLoadMore={() => void fetchNextPage()}
      workspaceId={workspace.id}
      onNewThread={onNewThread}
      onWorkspaceContextMenu={onWorkspaceContextMenu}
      rowProps={rowProps}
    />
  );
});
