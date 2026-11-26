import { useEffect, useState, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { CreateChannelDialog } from '@/components/channels/CreateChannelDialog';
import { useMachinesChannels } from '@/hooks/queries/useChannelQueries';
import { useMachinesModelMaps } from '@/hooks/queries/useModelQueries';
import { permissionNotifyEvent, useBackgroundNotify } from '@/hooks/useBackgroundNotify';
import { useMountEffect } from '@/hooks/useMountEffect';
import { getMachineClient } from '@/lib/api';
import { streamService } from '@/services/streamService';
import { streamConnection } from '@/services/streamConnection';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAuthStore } from '@/store/authStore';
import { useMachineStore } from '@/store/machineStore';
import { channelActivity, useChannelStore } from '@/store/channelStore';
import type { SidebarFilters } from '@/store/sidebarFilters';
import { useUIStore } from '@/store/uiStore';
import type { Workspace } from '@/types/workspace.types';
import { getAgentKindForModelId } from '@/types/chat.types';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { Channel } from '@/types/channel.types';
import { notifyPermissionRequest, notifyStreamComplete } from '@/utils/notifications';
import { calculateDropdownPosition } from './sidebarHelpers';
import { SidebarChannelItem } from './SidebarChannelItem';
import type { MachineBadge } from './SidebarChatItem';
import { LoadErrorState } from '@/components/ui/shared/LoadErrorState/LoadErrorState';
import { SidebarSectionHeader } from './SidebarSectionHeader';
import styles from './SidebarChannels.module.scss';

const COLLAPSED_CHANNEL_COUNT = 5;

interface SidebarChannelsProps {
  workspaces: Workspace[];
  workspaceId: string | undefined;
  filters: SidebarFilters;
  machineBadge: (machineId: string) => MachineBadge | undefined;
  selectedChannelId: string | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

export function SidebarChannels({
  workspaces,
  workspaceId: selectedWorkspaceId,
  filters,
  machineBadge,
  selectedChannelId,
  scrollContainerRef,
}: SidebarChannelsProps) {
  const workspaceId = workspaces.some((workspace) => workspace.id === selectedWorkspaceId)
    ? selectedWorkspaceId
    : undefined;
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const {
    machineChannels,
    isLoading: isLoadingChannels,
    load,
  } = useMachinesChannels(isAuthenticated);
  const modelMaps = useMachinesModelMaps(isAuthenticated);
  const liveActivity = useChannelStore((state) => state.activity);
  const completedChannelIds = useChannelStore((state) => state.completedChannelIds);
  const filteredChannels = machineChannels.filter(({ channel, machineId }) => {
    if (filters.workspaceId && channel.workspace_id !== filters.workspaceId) return false;
    if (
      filters.agentKind &&
      !channel.members.some(
        (member) =>
          (modelMaps.get(machineId)?.get(member.model_id)?.agent_kind ??
            getAgentKindForModelId(member.model_id)) === filters.agentKind,
      )
    ) {
      return false;
    }
    if (filters.source !== 'all' && machineId !== filters.source) return false;
    if (filters.statuses.length === 0) return true;
    const activity = channelActivity(liveActivity[channel.id], channel.activity);
    return (
      (filters.statuses.includes('unread') && !!channel.unread) ||
      (filters.statuses.includes('running') && activity.member_ids.length > 0) ||
      (filters.statuses.includes('done') && completedChannelIds.has(channel.id)) ||
      (filters.statuses.includes('needs-you') && activity.waiting_member_ids.length > 0)
    );
  });
  const channels = [
    ...filteredChannels.filter(({ channel }) => channel.pinned_at),
    ...filteredChannels.filter(({ channel }) => !channel.pinned_at),
  ];
  const isCollapsed = useUIStore((state) => state.collapsedSidebarSections.includes('channels'));
  const [isExpanded, setIsExpanded] = useState(false);
  const collapsedChannels = channels.filter(
    ({ channel }, index) =>
      channel.id === selectedChannelId || (!isCollapsed && index < COLLAPSED_CHANNEL_COUNT),
  );
  const hiddenCount = isCollapsed ? 0 : channels.length - collapsedChannels.length;
  const visibleChannels = isExpanded && !isCollapsed ? channels : collapsedChannels;
  const connections = useMachineStore((state) => state.connections);
  const notifyBackground = useBackgroundNotify();
  const liveMachineIdsKey = [...new Set(machineChannels.map(({ machineId }) => machineId))]
    .filter((id) => id === LOCAL_MACHINE_ID || connections[id]?.status === 'online')
    .join('\n');

  useEffect(() => {
    if (selectedChannelId && completedChannelIds.has(selectedChannelId)) {
      useChannelStore.getState().clearCompleted(selectedChannelId);
    }
  }, [selectedChannelId, completedChannelIds]);

  useEffect(
    () =>
      streamService.onChannelNotice((notice) =>
        notifyBackground(
          `/channels/${notice.channelId}`,
          notice.kind === 'channel_permission_request'
            ? permissionNotifyEvent(notice.payload.request.tool_name)
            : notice.kind === 'channel_asked'
              ? 'notify_questions'
              : 'notify_completions',
          (options) =>
            notice.kind === 'channel_permission_request'
              ? notifyPermissionRequest(notice.payload.request, options)
              : notifyStreamComplete({
                  ...options,
                  title: notice.payload.title,
                  message: notice.payload.body,
                }),
        ),
      ),
    [notifyBackground],
  );

  useEffect(() => {
    if (!liveMachineIdsKey) return;
    const releases = liveMachineIdsKey
      .split('\n')
      .map((machineId) => streamConnection.retain(getMachineClient(machineId)));
    return () => releases.forEach((release) => release());
  }, [liveMachineIdsKey]);

  const [createOpen, setCreateOpen] = useState(false);
  const openMenuChannelId = useUIStore((state) =>
    state.channelMenu?.source === 'sidebar' ? state.channelMenu.channel.id : null,
  );

  // The menu is fixed-positioned, so it would float at a stale spot once the list scrolls
  useMountEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    const handleScroll = () => {
      const ui = useUIStore.getState();
      if (ui.channelMenu?.source === 'sidebar') ui.setChannelMenu(null);
    };
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  });

  const navigateToChannel = (channelId: string) => {
    navigate(`/channels/${channelId}`);
    if (isMobile) useUIStore.getState().setSidebarOpen(false);
  };

  const handleDropdownClick = (e: React.MouseEvent<HTMLButtonElement>, channel: Channel) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    useUIStore.getState().toggleChannelMenu({
      channel,
      position: calculateDropdownPosition(rect),
      source: 'sidebar',
    });
  };

  return (
    <div className={styles.channels}>
      <SidebarSectionHeader title="Channels" section="channels">
        <Button
          variant="unstyled"
          onClick={() => setCreateOpen(true)}
          className={styles['new-btn']}
          aria-label="New channel"
        >
          <Plus className={styles['new-icon']} />
        </Button>
      </SidebarSectionHeader>
      {visibleChannels.map(({ channel, machineId }) => (
        <SidebarChannelItem
          key={channel.id}
          channel={channel}
          machineBadge={machineBadge(machineId)}
          isActive={channel.id === selectedChannelId}
          isCompleted={completedChannelIds.has(channel.id)}
          isDropdownOpen={openMenuChannelId === channel.id}
          onSelect={navigateToChannel}
          onDropdownClick={handleDropdownClick}
        />
      ))}
      {hiddenCount > 0 && (
        <Button
          variant="unstyled"
          type="button"
          onClick={() => setIsExpanded((expanded) => !expanded)}
          aria-expanded={isExpanded}
          className={styles['more-toggle']}
        >
          {isExpanded ? 'Show less' : `Show ${hiddenCount} more`}
        </Button>
      )}
      {!isCollapsed && machineChannels.length === 0 && load.loadFailed ? (
        <LoadErrorState variant="inline" message="Couldn't load channels" load={load} />
      ) : (
        !isCollapsed &&
        !isLoadingChannels &&
        channels.length === 0 && (
          <p className={styles.empty}>
            {machineChannels.length > 0
              ? 'No channels match the current filters'
              : 'No channels yet. Group chats where several agents share a workspace.'}
          </p>
        )
      )}

      {createOpen && (
        <CreateChannelDialog
          defaultWorkspaceId={workspaceId ?? workspaces[0]?.id ?? null}
          onClose={() => setCreateOpen(false)}
          onCreated={navigateToChannel}
        />
      )}
    </div>
  );
}
