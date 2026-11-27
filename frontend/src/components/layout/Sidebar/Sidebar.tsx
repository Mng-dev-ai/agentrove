import { useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { resolveChatAgentKind, type Chat } from '@/types/chat.types';
import type { Workspace } from '@/types/workspace.types';
import { useShowMoreUntilMatch, useSidebarChatLists } from '@/hooks/queries/useSidebarChatLists';
import { useMachinesChannels } from '@/hooks/queries/useChannelQueries';
import { useUIStore } from '@/store/uiStore';
import { useModelStore } from '@/store/modelStore';
import { useMachinesModelMaps } from '@/hooks/queries/useModelQueries';
import { useStreamStore } from '@/store/streamStore';
import { useBlockedChatIds } from '@/hooks/useBlockedChatIds';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useCurrentUserQuery } from '@/hooks/queries/useAuthQueries';
import { useAuthStore } from '@/store/authStore';
import { useLogout } from '@/hooks/useLogout';
import { UserProfileMenu } from '@/components/layout/UserProfileMenu/UserProfileMenu';
import { SidebarResizeHandle } from './SidebarResizeHandle';
import { SidebarActivityBar, SidebarActivityList } from './SidebarActivity';
import { SidebarChannelMenu } from './SidebarChannelMenu';
import { SidebarChannels } from './SidebarChannels';
import { SidebarChatList } from './SidebarChatList';
import { SidebarOverlays } from './SidebarOverlays';
import { type ChatRowProps } from './SidebarChatRow';
import {
  buildRecentChatSections,
  partitionLinkedChannels,
  renderedSectionChats,
} from './sidebarGrouping';
import { useSidebarChannelActions } from './useSidebarChannelActions';
import { useSidebarChatActions } from './useSidebarChatActions';
import { useSidebarWorkspaceActions } from './useSidebarWorkspaceActions';
import { useSidebarActivity } from './useSidebarActivity';
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
}

export function Sidebar({
  workspaces,
  selectedChatId,
  selectedChannelId = null,
  selectedChatWorkspaceId,
  selectedChatParentId,
  onChatSelect,
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
  const activityView = useUIStore((state) => state.sidebarActivityView);
  const setActivityView = useUIStore((state) => state.setSidebarActivityView);
  // Chats merge from two backends, so filters apply client-side over loaded
  // pages. Lives in the persisted uiStore so reloads keep the narrowed view.
  const storedFilters = useUIStore((state) => state.sidebarFilters);

  const machines = useMachineStore((state) => state.machines);
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

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const chatLists = useSidebarChatLists(workspaces, true, filters.source);
  const {
    pinnedChats,
    recentChats,
    workspaceBadgeById,
    machineWorkspaces,
    isLoadingChats,
    threadsLoad,
    pinnedLoad,
    recentsLoad,
  } = chatLists;

  const sidebarChats = useMemo(() => [...pinnedChats, ...recentChats], [pinnedChats, recentChats]);
  const {
    machineChannels,
    isLoading: isLoadingChannels,
    load: channelsLoad,
  } = useMachinesChannels(isAuthenticated);
  const channelActions = useSidebarChannelActions({
    machineChannels,
    selectedChannelId,
    isMobile,
    navigate,
    scrollContainerRef,
  });
  // A selected linked channel opens its parent's child list, as a selected sub-thread does
  const selectedChannelParentId = machineChannels.find(
    ({ channel }) => channel.id === selectedChannelId,
  )?.channel.parent_chat_id;
  const chatActions = useSidebarChatActions({
    selectedChatId,
    selectedChatParentId: selectedChatParentId ?? selectedChannelParentId,
    isMobile,
    navigate,
    scrollContainerRef,
    onChatSelect,
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
  const modelByChat = useModelStore((state) => state.modelByChat);
  const modelMaps = useMachinesModelMaps(isAuthenticated);
  const connections = useMachineStore((state) => state.connections);
  const hasActiveFilters = countActiveSidebarFilters(filters) > 0;
  const chatMatchesFilters = useCallback(
    (chat: Chat) => {
      if (filters.workspaceId && chat.workspace_id !== filters.workspaceId) return false;
      const machineId = chatOrigins.get(chat.id) ?? LOCAL_MACHINE_ID;
      if (
        filters.agentKind &&
        resolveChatAgentKind(
          modelMaps.get(machineId) ?? new Map(),
          chat.session_agent_kind,
          modelByChat[chat.id] ?? chat.last_model_id,
        ) !== filters.agentKind
      ) {
        return false;
      }
      if (filters.source !== 'all' && machineId !== filters.source) return false;
      if (filters.statuses.length === 0) return true;
      return (
        (filters.statuses.includes('unread') && chat.unread) ||
        (filters.statuses.includes('running') && streamingChatIdSet.has(chat.id)) ||
        (filters.statuses.includes('done') && completedChatIds.has(chat.id)) ||
        (filters.statuses.includes('needs-you') && blockedChatIdSet.has(chat.id))
      );
    },
    [
      filters,
      streamingChatIdSet,
      completedChatIds,
      blockedChatIdSet,
      chatOrigins,
      modelMaps,
      modelByChat,
    ],
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
  // Running, done and needs-you come from this session's streams, which sit on the newest
  // pages: fetching older pages for them alone would spend every round for nothing.
  const pagingCanMatch =
    hasActiveFilters && (filters.statuses.length === 0 || filters.statuses.includes('unread'));
  const showMore = useShowMoreUntilMatch(
    chatLists,
    visiblePinnedChats.length + visibleRecentChats.length,
    pagingCanMatch ? filters : null,
  );

  const machineBadge = useCallback(
    (machineId: string): MachineBadge | undefined => {
      if (machineId === LOCAL_MACHINE_ID) {
        return machines.length === 0 ? undefined : { name: LOCAL_MACHINE_NAME, offline: false };
      }
      return {
        name: machines.find((machine) => machine.id === machineId)?.name ?? 'Removed machine',
        offline: connections[machineId]?.status !== 'online',
      };
    },
    [machines, connections],
  );
  const machineBadgeForChat = useCallback(
    (chatId: string) => machineBadge(chatOrigins.get(chatId) ?? LOCAL_MACHINE_ID),
    [machineBadge, chatOrigins],
  );

  const collapsedSections = useUIStore((state) => state.collapsedSidebarSections);
  const { linkedByParentId, topLevel: topLevelChannels } = useMemo(() => {
    const openChatIds = { selectedChatId, splitChatIds };
    const parentRows = [
      ...renderedSectionChats(
        visiblePinnedChats,
        collapsedSections.includes('pinned'),
        openChatIds,
      ),
      ...renderedSectionChats(
        visibleRecentChats,
        collapsedSections.includes('recents'),
        openChatIds,
      ),
    ];
    return partitionLinkedChannels(
      machineChannels,
      new Map(parentRows.map((chat) => [chat.id, chatOrigins.get(chat.id) ?? LOCAL_MACHINE_ID])),
    );
  }, [
    visiblePinnedChats,
    visibleRecentChats,
    collapsedSections,
    selectedChatId,
    splitChatIds,
    machineChannels,
    chatOrigins,
  ]);
  const { entriesByKind, childActivityByParentId } = useSidebarActivity(
    streamingChatIdSet,
    blockedChatIdSet,
    machineChannels,
    linkedByParentId,
  );

  const groupBy = filters.groupBy;
  const recentChatSections = useMemo(
    () =>
      buildRecentChatSections({
        groupBy,
        visibleRecentChats,
        workspaceBadgeById,
        streamingChatIdSet,
        completedChatIds,
      }),
    [groupBy, visibleRecentChats, workspaceBadgeById, streamingChatIdSet, completedChatIds],
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

  const rowProps: ChatRowProps = {
    selectedChatId,
    splitChatIds,
    hoveredChatId: chatActions.hoveredChatId,
    dropdownChatId:
      chatActions.dropdown?.source === 'sidebar' ? chatActions.dropdown.chat.id : null,
    streamingChatIdSet,
    blockedChatIdSet,
    completedChatIdSet: completedChatIds,
    workspaceBadgeById,
    machineBadgeForChat,
    onChatSelect: chatActions.handleChatSelect,
    onOpenInSplit: chatActions.showSplitAffordance ? chatActions.handleOpenInSplit : undefined,
    canOpenChatInSplit: chatActions.canOpenChatInSplit,
    onDropdownClick: chatActions.handleDropdownClick,
    onMouseEnter: chatActions.handleChatMouseEnter,
    onMouseLeave: chatActions.handleChatMouseLeave,
    expandedSubThreads: chatActions.expandedSubThreads,
    onToggleSubThreads: chatActions.handleToggleSubThreads,
    childActivityByParentId,
    linkedChannelsByParentId: linkedByParentId,
    selectedChannelId,
    openMenuChannelId: channelActions.openMenuChannelId,
    completedChannelIds: channelActions.completedChannelIds,
    onChannelSelect: channelActions.handleChannelSelect,
    onChannelDropdownClick: channelActions.handleChannelDropdownClick,
  };

  return (
    <>
      <aside
        aria-label="Chat history"
        className={clsx(styles.sidebar, sidebarOpen && styles['sidebar--open'])}
        aria-hidden={isMobile && !sidebarOpen ? true : undefined}
        inert={isMobile && !sidebarOpen}
      >
        <SidebarActivityBar
          counts={{
            running: entriesByKind.running.length,
            'needs-you': entriesByKind['needs-you'].length,
          }}
          view={activityView}
          onChangeView={setActivityView}
        />

        {/* One container for both views: the dropdowns' scroll-to-dismiss listeners
            attach to it once on mount. */}
        <div ref={scrollContainerRef} className={styles.scroll}>
          {activityView ? (
            <SidebarActivityList
              view={activityView}
              entries={entriesByKind[activityView]}
              rowProps={rowProps}
              machineBadge={machineBadge}
              onClose={() => setActivityView(null)}
            />
          ) : (
            <SidebarChatList
              channels={
                <SidebarChannels
                  workspaces={workspaces}
                  workspaceId={selectedChatWorkspaceId ?? undefined}
                  filters={filters}
                  machineBadge={machineBadge}
                  selectedChannelId={selectedChannelId}
                  machineChannels={topLevelChannels}
                  hasNestedChannels={linkedByParentId.size > 0}
                  isLoadingChannels={isLoadingChannels}
                  load={channelsLoad}
                  channelActions={channelActions}
                />
              }
              isLoadingChats={isLoadingChats}
              threadsLoad={threadsLoad}
              pinnedLoad={pinnedLoad}
              recentsLoad={recentsLoad}
              hasAnyContent={hasAnyContent}
              pinnedChats={visiblePinnedChats}
              recentChats={visibleRecentChats}
              hasVisibleContent={hasVisibleContent}
              recentChatSections={recentChatSections}
              rowProps={rowProps}
              filters={filters}
              onChangeFilters={(next) => useUIStore.getState().setSidebarFilters(next)}
              workspaceBadgeById={workspaceBadgeById}
              machineOptions={machineOptions}
              hasMore={showMore.hasMore}
              isFetchingMore={showMore.isFetchingMore}
              onLoadMore={showMore.loadMore}
              canShowLess={showMore.canShowLess}
              onShowLess={showMore.showLess}
            />
          )}
        </div>

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
      <SidebarChannelMenu selectedChannelId={selectedChannelId} />
    </>
  );
}
