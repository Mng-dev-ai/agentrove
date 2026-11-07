import { useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import type { Chat } from '@/types/chat.types';
import type { Workspace } from '@/types/workspace.types';
import { useSidebarChatLists } from '@/hooks/queries/useSidebarChatLists';
import { useUIStore } from '@/store/uiStore';
import { useStreamStore } from '@/store/streamStore';
import { useBlockedChatIds } from '@/hooks/useBlockedChatIds';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useCurrentUserQuery } from '@/hooks/queries/useAuthQueries';
import { useAuthStore } from '@/store/authStore';
import { useLogout } from '@/hooks/useLogout';
import { UserProfileMenu } from '@/components/layout/UserProfileMenu/UserProfileMenu';
import { SidebarResizeHandle } from './SidebarResizeHandle';
import { SidebarActions } from './SidebarActions';
import { SidebarChannels } from './SidebarChannels';
import { SidebarChatList } from './SidebarChatList';
import { SidebarOverlays } from './SidebarOverlays';
import { type ChatRowProps } from './SidebarChatRow';
import { buildRecentChatSections } from './sidebarGrouping';
import { useSidebarChatActions } from './useSidebarChatActions';
import { useSidebarWorkspaceActions } from './useSidebarWorkspaceActions';
import { countActiveSidebarFilters, withKnownSource } from '@/store/sidebarFilters';
import { useChatOrigins } from '@/store/machineOrigin';
import { LOCAL_MACHINE_NAME, useMachineStore } from '@/store/machineStore';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { MachineBadge } from './SidebarChatItem';
import styles from './Sidebar.module.scss';

export interface SidebarProps {
  workspaces: Workspace[];
  selectedChatId: string | null;
  selectedChannelId?: string | null;
  selectedChatWorkspaceId?: string | null;
  selectedChatParentId?: string | null;
  onChatSelect: (chatId: string) => void;
  onDeleteChat?: (chatId: string) => void;
}

export function Sidebar({
  workspaces,
  selectedChatId,
  selectedChannelId = null,
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
  const splitChatIds = useUIStore((state) => state.splitChatIds);
  const streamingChatIdSet = useMemo(
    () => new Set(activeStreamMetadata.map((meta) => meta.chatId)),
    [activeStreamMetadata],
  );
  // Chats with a pending plan/permission request or agent question form — the
  // agent is blocked on the user.
  const blockedChatIdSet = useBlockedChatIds();
  // Chats merge from two backends, so filters apply client-side over loaded
  // pages. Lives in the persisted uiStore so reloads keep the narrowed view.
  const storedFilters = useUIStore((state) => state.sidebarFilters);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const {
    pinnedChats,
    recentChats,
    workspaceBadgeById,
    machineWorkspaces,
    isLoadingChats,
    hasMore,
    isFetchingMore,
    loadMore,
  } = useSidebarChatLists(workspaces);

  const sidebarChats = useMemo(() => [...pinnedChats, ...recentChats], [pinnedChats, recentChats]);
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
    selectedChannelId,
    selectedChatWorkspaceId,
    isMobile,
    navigate,
    workspaceBadgeById,
    chats: sidebarChats,
    scrollContainerRef,
  });

  const hasAnyContent = pinnedChats.length > 0 || recentChats.length > 0;

  // Status filters OR together (any selected badge state matches); source and
  // workspace AND with them. Ownership comes from the machine origin map (set at
  // fetch time, hydrated at module load) — the workspace badge map lags behind the
  // per-machine workspaces queries and would misclassify remote chats meanwhile.
  const chatOrigins = useChatOrigins();
  const machines = useMachineStore((state) => state.machines);
  const connections = useMachineStore((state) => state.connections);
  const machineOptions = useMemo(
    () => [
      { id: LOCAL_MACHINE_ID, name: LOCAL_MACHINE_NAME },
      ...machines.map((machine) => ({ id: machine.id, name: machine.name })),
    ],
    [machines],
  );
  const filters = useMemo(
    () =>
      withKnownSource(
        storedFilters,
        machineOptions.map((machine) => machine.id),
      ),
    [storedFilters, machineOptions],
  );
  const hasActiveFilters = countActiveSidebarFilters(filters) > 0;
  const machineBadgeForChat = useCallback(
    (chatId: string): MachineBadge | undefined => {
      const machineId = chatOrigins.get(chatId) ?? LOCAL_MACHINE_ID;
      if (machineId === LOCAL_MACHINE_ID) {
        return machines.length === 0 ? undefined : { name: LOCAL_MACHINE_NAME, offline: false };
      }
      return {
        name: machines.find((machine) => machine.id === machineId)?.name ?? 'Removed machine',
        offline: connections[machineId]?.status !== 'online',
      };
    },
    [machines, connections, chatOrigins],
  );
  const chatMatchesFilters = useCallback(
    (chat: Chat) => {
      if (filters.workspaceId && chat.workspace_id !== filters.workspaceId) return false;
      if (filters.agentKind && chat.session_agent_kind !== filters.agentKind) return false;
      if (
        filters.source !== 'all' &&
        (chatOrigins.get(chat.id) ?? LOCAL_MACHINE_ID) !== filters.source
      ) {
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
    [filters, streamingChatIdSet, completedChatIds, blockedChatIdSet, chatOrigins],
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
  const showWorkspaceBadges = useMemo(
    () =>
      new Set([...visiblePinnedChats, ...visibleRecentChats].map((chat) => chat.workspace_id))
        .size > 1,
    [visiblePinnedChats, visibleRecentChats],
  );
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
    for (const splitChatId of splitChatIds) {
      if (completedChatIds.has(splitChatId)) store.clearCompleted(splitChatId);
    }
  }, [selectedChatId, splitChatIds, completedChatIds]);

  const handleNewChat = useCallback(() => {
    navigate('/');
    if (isMobile) {
      useUIStore.getState().setSidebarOpen(false);
    }
  }, [navigate, isMobile]);

  const handleOpenInbox = useCallback(() => {
    navigate('/inbox');
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
    splitChatIds,
    hoveredChatId: chatActions.hoveredChatId,
    dropdownChatId: chatActions.dropdown?.chat.id ?? null,
    streamingChatIdSet,
    blockedChatIdSet,
    completedChatIdSet: completedChatIds,
    workspaceBadgeById,
    machineBadgeForChat,
    showWorkspaceBadges,
    onChatSelect: chatActions.handleChatSelect,
    onOpenInSplit: chatActions.showSplitAffordance ? chatActions.handleOpenInSplit : undefined,
    canOpenChatInSplit: chatActions.canOpenChatInSplit,
    onDropdownClick: chatActions.handleDropdownClick,
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
        <SidebarActions
          onNewChat={handleNewChat}
          onOpenSearch={handleOpenSearch}
          onOpenInbox={handleOpenInbox}
        />

        <SidebarChatList
          scrollContainerRef={scrollContainerRef}
          channels={
            <SidebarChannels
              workspaces={workspaces}
              workspaceId={selectedChatWorkspaceId ?? undefined}
              filterWorkspaceId={filters.workspaceId}
              selectedChannelId={selectedChannelId}
              scrollContainerRef={scrollContainerRef}
            />
          }
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
          machineOptions={machineOptions}
          hasMore={hasMore}
          isFetchingMore={isFetchingMore}
          onLoadMore={loadMore}
        />

        {/* Always render footer so settings/logout work even if the user query fails. */}
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
        machineWorkspaces={machineWorkspaces}
      />
    </>
  );
}
