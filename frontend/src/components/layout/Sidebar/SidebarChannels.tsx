import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { CreateChannelDialog } from '@/components/channels/CreateChannelDialog';
import type { ListLoadState } from '@/hooks/queries/listLoad';
import { useMachinesModelMaps } from '@/hooks/queries/useModelQueries';
import { useAuthStore } from '@/store/authStore';
import { channelActivity, useChannelStore } from '@/store/channelStore';
import type { SidebarFilters } from '@/store/sidebarFilters';
import { useUIStore } from '@/store/uiStore';
import type { Workspace } from '@/types/workspace.types';
import { getAgentKindForModelId } from '@/types/chat.types';
import { SidebarChannelItem } from './SidebarChannelItem';
import type { MachineBadge } from './SidebarChatItem';
import type { MachineChannel } from './sidebarGrouping';
import type { SidebarChannelActions } from './useSidebarChannelActions';
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
  // Channels not nested under a rendered parent chat
  machineChannels: MachineChannel[];
  hasNestedChannels: boolean;
  isLoadingChannels: boolean;
  load: ListLoadState;
  channelActions: SidebarChannelActions;
}

export function SidebarChannels({
  workspaces,
  workspaceId: selectedWorkspaceId,
  filters,
  machineBadge,
  selectedChannelId,
  machineChannels,
  hasNestedChannels,
  isLoadingChannels,
  load,
  channelActions,
}: SidebarChannelsProps) {
  const workspaceId = workspaces.some((workspace) => workspace.id === selectedWorkspaceId)
    ? selectedWorkspaceId
    : undefined;
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const modelMaps = useMachinesModelMaps(isAuthenticated);
  const liveActivity = useChannelStore((state) => state.activity);
  const {
    completedChannelIds,
    openMenuChannelId,
    handleChannelSelect,
    handleChannelDropdownClick,
  } = channelActions;
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
  const [createOpen, setCreateOpen] = useState(false);

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
          onSelect={handleChannelSelect}
          onDropdownClick={handleChannelDropdownClick}
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
      {!isCollapsed && machineChannels.length === 0 && !hasNestedChannels && load.loadFailed ? (
        <LoadErrorState variant="inline" message="Couldn't load channels" load={load} />
      ) : (
        !isCollapsed &&
        !isLoadingChannels &&
        channels.length === 0 &&
        // No empty copy when every channel is nested under its parent chat
        (machineChannels.length > 0 || !hasNestedChannels) && (
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
          onCreated={handleChannelSelect}
        />
      )}
    </div>
  );
}
