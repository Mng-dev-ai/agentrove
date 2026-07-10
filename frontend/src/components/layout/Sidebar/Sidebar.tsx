import { useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import type { Chat } from '@/types/chat.types';
import type { Workspace } from '@/types/workspace.types';
import { useSidebarChatLists } from '@/hooks/queries/useSidebarChatLists';
import { useUIStore } from '@/store/uiStore';
import { useStreamStore } from '@/store/streamStore';
import { usePermissionStore } from '@/store/permissionStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useCurrentUserQuery } from '@/hooks/queries/useAuthQueries';
import { useAuthStore } from '@/store/authStore';
import { useLogout } from '@/hooks/useLogout';
import { UserProfileMenu } from '@/components/layout/UserProfileMenu/UserProfileMenu';
import { SidebarResizeHandle } from './SidebarResizeHandle';
import { SidebarActions } from './SidebarActions';
import { SidebarChatList } from './SidebarChatList';
import { SidebarOverlays } from './SidebarOverlays';
import { type ChatRowProps } from './SidebarChatRow';
import { buildRecentChatSections } from './sidebarGrouping';
import { useSidebarChatActions } from './useSidebarChatActions';
import { useSidebarWorkspaceActions } from './useSidebarWorkspaceActions';
import { countActiveSidebarFilters } from '@/store/sidebarFilters';
import { isCloudChat } from '@/utils/chatOrigin';
import styles from './Sidebar.module.scss';

export interface SidebarProps {
  workspaces: Workspace[];
  selectedChatId: string | null;
  selectedChatWorkspaceId?: string | null;
  selectedChatParentId?: string | null;
  onChatSelect: (chatId: string) => void;
  onDeleteChat?: (chatId: string) => void;
}

export function Sidebar({
  workspaces,
  selectedChatId,
  selectedChatWorkspaceId,
  selectedChatParentId,
  onChatSelect,
  onDeleteChat,
}: SidebarProps) {
  const navigate = useNavigate();
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const isMobile = useIsMobile();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { data: currentUser } = useCurrentUserQuery({ enabled: isAuthenticated });
  const userDisplayName = currentUser?.username || currentUser?.email || '';
  const logoutMutation = useLogout();
  const activeStreamMetadata = useStreamStore((state) => state.activeStreamMetadata);
  // Chats whose stream finished successfully since last viewed — drives the "Done" badge
  const completedChatIds = useStreamStore((state) => state.completedChatIds);
  const secondaryChatId = useUIStore((state) => state.secondaryChatId);
  const streamingChatIdSet = useMemo(
    () => new Set(activeStreamMetadata.map((meta) => meta.chatId)),
    [activeStreamMetadata],
  );
  // Chats with a pending plan/question/permission request — the agent is
  // blocked on the user. Empty queues are deleted from the store, so every
  // remaining key has an outstanding request.
  const pendingRequests = usePermissionStore((state) => state.pendingRequests);
  const blockedChatIdSet = useMemo(() => new Set(pendingRequests.keys()), [pendingRequests]);
  // Chats merge from two backends, so filters apply client-side over loaded
  // pages. Lives in the persisted uiStore so reloads keep the narrowed view.
  const filters = useUIStore((state) => state.sidebarFilters);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const {
    pinnedChats,
    recentChats,
    workspaceBadgeById,
    cloudWorkspaces,
    isLoadingChats,
    hasMore,
    isFetchingMore,
    loadMore,
  } = useSidebarChatLists(workspaces);

  const chatActions = useSidebarChatActions({
    selectedChatId,
    selectedChatParentId,
    isMobile,
    navigate,
    scrollContainerRef,
    onChatSelect,
    onDeleteChat,
  });
  const workspaceActions = useSidebarWorkspaceActions({
    selectedChatId,
    selectedChatWorkspaceId,
    isMobile,
    navigate,
    workspaceBadgeById,
    scrollContainerRef,
  });

  const hasAnyContent = pinnedChats.length > 0 || recentChats.length > 0;

  const hasActiveFilters = countActiveSidebarFilters(filters) > 0;
  // Status filters OR together (any selected badge state matches); source and
  // workspace AND with them. Cloud-ness comes from chatOrigin (marked at fetch
  // time, hydrated at module load) — the workspace badge map lags behind the
  // cloud workspaces query and would misclassify cloud chats as local meanwhile.
  const chatMatchesFilters = useCallback(
    (chat: Chat) => {
      if (filters.workspaceId && chat.workspace_id !== filters.workspaceId) return false;
      if (filters.agentKind && chat.session_agent_kind !== filters.agentKind) return false;
      if (filters.source !== 'all' && isCloudChat(chat.id) !== (filters.source === 'cloud')) {
        return false;
      }
      if (filters.statuses.length === 0) return true;
      return (
        (filters.statuses.includes('unread') && chat.unread) ||
        (filters.statuses.includes('running') && streamingChatIdSet.has(chat.id)) ||
        (filters.statuses.includes('done') && completedChatIds.has(chat.id)) ||
        (filters.statuses.includes('needs-you') && blockedChatIdSet.has(chat.id))
      );
    },
    [filters, streamingChatIdSet, completedChatIds, blockedChatIdSet],
  );
  const visiblePinnedChats = useMemo(
    () => (hasActiveFilters ? pinnedChats.filter(chatMatchesFilters) : pinnedChats),
    [hasActiveFilters, pinnedChats, chatMatchesFilters],
  );
  const visibleRecentChats = useMemo(
    () => (hasActiveFilters ? recentChats.filter(chatMatchesFilters) : recentChats),
    [hasActiveFilters, recentChats, chatMatchesFilters],
  );
  const hasVisibleContent = visiblePinnedChats.length > 0 || visibleRecentChats.length > 0;

  const groupBy = filters.groupBy;
  const recentChatSections = useMemo(
    () =>
      buildRecentChatSections({
        groupBy,
        visibleRecentChats,
        workspaceBadgeById,
        blockedChatIdSet,
        streamingChatIdSet,
        completedChatIds,
      }),
    [
      groupBy,
      visibleRecentChats,
      workspaceBadgeById,
      blockedChatIdSet,
      streamingChatIdSet,
      completedChatIds,
    ],
  );

  // Opening a chat (or watching it finish while open) counts as seeing the
  // completion — clear its Done badge. Covers every open path since both ids
  // are route/layout-derived, not sidebar-click-derived.
  useEffect(() => {
    const store = useStreamStore.getState();
    if (selectedChatId && completedChatIds.has(selectedChatId)) {
      store.clearCompleted(selectedChatId);
    }
    if (secondaryChatId && completedChatIds.has(secondaryChatId)) {
      store.clearCompleted(secondaryChatId);
    }
  }, [selectedChatId, secondaryChatId, completedChatIds]);

  const handleNewChat = useCallback(() => {
    navigate('/');
    if (isMobile) {
      useUIStore.getState().setSidebarOpen(false);
    }
  }, [navigate, isMobile]);

  const handleOpenSearch = useCallback(() => {
    useUIStore.getState().setCommandMenuOpen(true);
    // Close the drawer on mobile so the destination isn't hidden behind it after picking a result
    if (isMobile) {
      useUIStore.getState().setSidebarOpen(false);
    }
  }, [isMobile]);

  const rowProps: ChatRowProps = {
    selectedChatId,
    secondaryChatId,
    hoveredChatId: chatActions.hoveredChatId,
    dropdownChatId: chatActions.dropdown?.chat.id ?? null,
    streamingChatIdSet,
    blockedChatIdSet,
    completedChatIdSet: completedChatIds,
    workspaceBadgeById,
    onChatSelect: chatActions.handleChatSelect,
    onOpenInSplit: chatActions.canOpenInSplit ? chatActions.handleOpenInSplit : undefined,
    onDropdownClick: chatActions.handleDropdownClick,
    onWorkspaceBadgeClick: workspaceActions.handleWorkspaceContextMenu,
    onMouseEnter: chatActions.handleChatMouseEnter,
    onMouseLeave: chatActions.handleChatMouseLeave,
    expandedSubThreads: chatActions.expandedSubThreads,
    onToggleSubThreads: chatActions.handleToggleSubThreads,
  };

  return (
    <>
      <aside
        aria-label="Chat history"
        className={clsx(styles.sidebar, sidebarOpen && styles['sidebar--open'])}
      >
        <SidebarActions onNewChat={handleNewChat} onOpenSearch={handleOpenSearch} />

        <SidebarChatList
          scrollContainerRef={scrollContainerRef}
          isLoadingChats={isLoadingChats}
          hasAnyContent={hasAnyContent}
          visiblePinnedChats={visiblePinnedChats}
          visibleRecentChats={visibleRecentChats}
          hasVisibleContent={hasVisibleContent}
          recentChatSections={recentChatSections}
          rowProps={rowProps}
          filters={filters}
          onChangeFilters={(next) => useUIStore.getState().setSidebarFilters(next)}
          workspaceBadgeById={workspaceBadgeById}
          hasMore={hasMore}
          isFetchingMore={isFetchingMore}
          onLoadMore={loadMore}
        />

        {/* User profile — fixed at sidebar bottom; always rendered so settings/logout are accessible even if the user query is loading or failed */}
        <div className={styles.footer}>
          <UserProfileMenu
            displayName={userDisplayName}
            onOpenSettings={() => navigate('/settings')}
            onSignOut={() => logoutMutation.mutate()}
          />
        </div>
        {!isMobile && <SidebarResizeHandle />}
      </aside>

      <SidebarOverlays
        chat={chatActions}
        workspace={workspaceActions}
        workspaces={workspaces}
        cloudWorkspaces={cloudWorkspaces}
      />
    </>
  );
}
