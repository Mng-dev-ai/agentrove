import { useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  getAgentKindForModelId,
  resolveChatAgentKind,
  type AgentKind,
  type Chat,
} from '@/types/chat.types';
import type { Workspace } from '@/types/workspace.types';
import { useShowMoreUntilMatch, useSidebarChatLists } from '@/hooks/queries/useSidebarChatLists';
import { useMachinesChannels } from '@/hooks/queries/useChannelQueries';
import { useUIStore } from '@/store/uiStore';
import { channelActivity, useChannelStore } from '@/store/channelStore';
import { useModelStore } from '@/store/modelStore';
import { useMachinesModelMaps } from '@/hooks/queries/useModelQueries';
import { useStreamStore } from '@/store/streamStore';
import { useBlockedChatIds } from '@/hooks/useBlockedChatIds';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useMountEffect } from '@/hooks/useMountEffect';
import { isEmbeddedEditor } from '@/hooks/useCommandMenu';
import { isModalLayerOpen } from '@/components/ui/shared/BaseModal/useModalLayer';
import { useCurrentUserQuery } from '@/hooks/queries/useAuthQueries';
import { useAuthStore } from '@/store/authStore';
import { useLogout } from '@/hooks/useLogout';
import { UserProfileMenu } from '@/components/layout/UserProfileMenu/UserProfileMenu';
import { SidebarResizeHandle } from './SidebarResizeHandle';
import { SidebarActivityBar, SidebarActivityList } from './SidebarActivity';
import { SidebarChannelMenu } from './SidebarChannelMenu';
import { SidebarChatList } from './SidebarChatList';
import { SidebarOverlays } from './SidebarOverlays';
import { type ChatRowProps } from './SidebarChatRow';
import {
  buildRecentSections,
  mergeSidebarThreads,
  partitionLinkedChannels,
  type MachineChannel,
  type SidebarThread,
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

  // ⌥↑/⌥↓ step through the rows as rendered, clicking the target so it opens as a click would
  useMountEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (isEmbeddedEditor(e.target) || isModalLayerOpen()) return;
      const container = scrollContainerRef.current;
      if (!container) return;
      e.preventDefault();
      const rows = [...container.querySelectorAll<HTMLElement>('[data-sidebar-thread]')];
      const current = rows.findIndex((row) => row.getAttribute('aria-current') === 'page');
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const target = rows[current === -1 ? (step === 1 ? 0 : rows.length - 1) : current + step];
      target?.click();
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  });

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

  const hasAnyContent =
    pinnedChats.length > 0 || recentChats.length > 0 || machineChannels.length > 0;

  // Status filters OR together (any selected badge state matches); source and
  // workspace AND with them. Ownership comes from the machine origin map (set at
  // fetch time, hydrated at module load) — the workspace badge map lags behind the
  // per-machine workspaces queries and would misclassify remote chats meanwhile.
  const chatOrigins = useChatOrigins();
  const modelByChat = useModelStore((state) => state.modelByChat);
  const modelMaps = useMachinesModelMaps(isAuthenticated);
  const connections = useMachineStore((state) => state.connections);
  const liveChannelActivity = useChannelStore((state) => state.activity);
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
  const channelAgentKinds = useCallback(
    ({ channel, machineId }: MachineChannel): AgentKind[] =>
      channel.members.map(
        (member) =>
          modelMaps.get(machineId)?.get(member.model_id)?.agent_kind ??
          getAgentKindForModelId(member.model_id),
      ),
    [modelMaps],
  );
  const { completedChannelIds } = channelActions;
  // A channel matches the agent filter when any member runs that agent
  const channelMatchesFilters = useCallback(
    (entry: MachineChannel) => {
      const { channel, machineId } = entry;
      if (filters.workspaceId && channel.workspace_id !== filters.workspaceId) return false;
      if (filters.agentKind && !channelAgentKinds(entry).includes(filters.agentKind)) return false;
      if (filters.source !== 'all' && machineId !== filters.source) return false;
      if (filters.statuses.length === 0) return true;
      const activity = channelActivity(liveChannelActivity[channel.id], channel.activity);
      return (
        (filters.statuses.includes('unread') && !!channel.unread) ||
        (filters.statuses.includes('running') && activity.member_ids.length > 0) ||
        (filters.statuses.includes('done') && completedChannelIds.has(channel.id)) ||
        (filters.statuses.includes('needs-you') && activity.waiting_member_ids.length > 0)
      );
    },
    [filters, channelAgentKinds, liveChannelActivity, completedChannelIds],
  );
  const visiblePinnedChats = useMemo(
    () => (hasActiveFilters ? pinnedChats.filter(chatMatchesFilters) : pinnedChats),
    [hasActiveFilters, pinnedChats, chatMatchesFilters],
  );
  const visibleRecentChats = useMemo(
    () => (hasActiveFilters ? recentChats.filter(chatMatchesFilters) : recentChats),
    [hasActiveFilters, recentChats, chatMatchesFilters],
  );
  const visibleChannels = useMemo(
    () => (hasActiveFilters ? machineChannels.filter(channelMatchesFilters) : machineChannels),
    [hasActiveFilters, machineChannels, channelMatchesFilters],
  );
  const recentsFloor = chatLists.hasMore
    ? (recentChats[recentChats.length - 1]?.updated_at ?? null)
    : null;
  const merged = useMemo(
    () =>
      mergeSidebarThreads({
        pinnedChats: visiblePinnedChats,
        recentChats: visibleRecentChats,
        channels: visibleChannels,
        recentsFloor,
        selectedChannelId,
        threadType: filters.threadType,
      }),
    [
      visiblePinnedChats,
      visibleRecentChats,
      visibleChannels,
      recentsFloor,
      selectedChannelId,
      filters.threadType,
    ],
  );
  const hasVisibleContent = merged.pinned.length > 0 || merged.recents.length > 0;
  // Running, done and needs-you come from this session's streams, which sit on the newest
  // pages: fetching older pages for them alone would spend every round for nothing.
  const pagingCanMatch =
    hasActiveFilters &&
    filters.threadType !== 'group' &&
    (filters.statuses.length === 0 || filters.statuses.includes('unread'));
  const showMore = useShowMoreUntilMatch(
    chatLists,
    merged.pinned.length + merged.recents.length,
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

  // A collapsed section still renders its open threads, so the current selection never
  // disappears
  const collapsedSections = useUIStore((state) => state.collapsedSidebarSections);
  const isPinnedCollapsed = collapsedSections.includes('pinned');
  const isRecentsCollapsed = collapsedSections.includes('recents');
  const isOpenThread = useCallback(
    (thread: SidebarThread) =>
      thread.kind === 'chat'
        ? thread.chat.id === selectedChatId || splitChatIds.includes(thread.chat.id)
        : thread.channel.id === selectedChannelId,
    [selectedChatId, splitChatIds, selectedChannelId],
  );
  // Linked channels nest under exactly the chat rows rendered, so only the rest join the list
  const { pinnedRows, recentRows, linkedByParentId } = useMemo(() => {
    const pinnedShown = isPinnedCollapsed ? merged.pinned.filter(isOpenThread) : merged.pinned;
    const recentShown = isRecentsCollapsed ? merged.recents.filter(isOpenThread) : merged.recents;
    const renderedChatMachines = new Map(
      [...pinnedShown, ...recentShown].flatMap((thread) =>
        thread.kind === 'chat'
          ? [[thread.chat.id, chatOrigins.get(thread.chat.id) ?? LOCAL_MACHINE_ID] as const]
          : [],
      ),
    );
    const partition = partitionLinkedChannels(machineChannels, renderedChatMachines);
    const topLevelIds = new Set(partition.topLevel.map(({ channel }) => channel.id));
    const isTopLevel = (thread: SidebarThread) =>
      thread.kind === 'chat' || topLevelIds.has(thread.channel.id);
    return {
      pinnedRows: pinnedShown.filter(isTopLevel),
      recentRows: recentShown.filter(isTopLevel),
      linkedByParentId: partition.linkedByParentId,
    };
  }, [merged, isPinnedCollapsed, isRecentsCollapsed, isOpenThread, machineChannels, chatOrigins]);
  // A selected nested channel opens its parent's child list, as a selected sub-thread does
  const selectedChannelParentId = [...linkedByParentId].find(([, linked]) =>
    linked.some(({ channel }) => channel.id === selectedChannelId),
  )?.[0];
  const chatActions = useSidebarChatActions({
    selectedChatId,
    selectedChatParentId: selectedChatParentId ?? selectedChannelParentId,
    isMobile,
    navigate,
    scrollContainerRef,
    onChatSelect,
  });
  const { entriesByKind, childActivityByParentId } = useSidebarActivity(
    streamingChatIdSet,
    blockedChatIdSet,
    machineChannels,
    linkedByParentId,
  );

  const groupBy = filters.groupBy;
  const runningChannelIds = useMemo(
    () =>
      machineChannels
        .filter(
          ({ channel }) =>
            channelActivity(liveChannelActivity[channel.id], channel.activity).member_ids.length >
            0,
        )
        .map(({ channel }) => channel.id),
    [machineChannels, liveChannelActivity],
  );
  const recentSections = useMemo(
    () =>
      buildRecentSections({
        groupBy,
        visibleRecentThreads: recentRows,
        workspaceBadgeById,
        runningIds: new Set([...streamingChatIdSet, ...runningChannelIds]),
        completedIds: new Set([...completedChatIds, ...completedChannelIds]),
      }),
    [
      groupBy,
      recentRows,
      workspaceBadgeById,
      streamingChatIdSet,
      runningChannelIds,
      completedChatIds,
      completedChannelIds,
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
    machineBadge,
    machineBadgeForChat,
    channelAgentKinds,
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
    channelActions,
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
              onClose={() => setActivityView(null)}
            />
          ) : (
            <SidebarChatList
              isLoading={isLoadingChats || isLoadingChannels}
              threadsLoad={threadsLoad}
              pinnedLoad={pinnedLoad}
              recentsLoad={recentsLoad}
              channelsLoad={channelsLoad}
              hasAnyContent={hasAnyContent}
              hasChannels={machineChannels.length > 0}
              hasPinned={merged.pinned.length > 0}
              hasRecents={merged.recents.length > 0}
              pinnedRows={pinnedRows}
              recentRows={recentRows}
              isRecentsCollapsed={isRecentsCollapsed}
              hasVisibleContent={hasVisibleContent}
              recentSections={recentSections}
              rowProps={rowProps}
              filters={filters}
              onChangeFilters={(next) => useUIStore.getState().setSidebarFilters(next)}
              workspaceBadgeById={workspaceBadgeById}
              machineOptions={machineOptions}
              // Chat pages add no rows to a group-only list
              hasMore={showMore.hasMore && filters.threadType !== 'group'}
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
