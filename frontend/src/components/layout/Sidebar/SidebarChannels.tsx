import { useEffect, useRef, useState, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { Edit2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog/ConfirmDialog';
import { RenameModal } from '@/components/ui/RenameModal/RenameModal';
import { CreateChannelDialog } from '@/components/channels/CreateChannelDialog';
import {
  useDeleteChannelMutation,
  useMachinesChannels,
  useRenameChannelMutation,
} from '@/hooks/queries/useChannelQueries';
import { useBackgroundNotify } from '@/hooks/useBackgroundNotify';
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
import { calculateDropdownPosition, mutateWithToast } from './sidebarHelpers';
import { SidebarChannelItem } from './SidebarChannelItem';
import type { MachineBadge } from './SidebarChatItem';
import { SidebarMenu, SidebarMenuItem } from './SidebarMenu';
import { SidebarSectionHeader } from './SidebarSectionHeader';
import styles from './SidebarChannels.module.scss';

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
  const machineChannels = useMachinesChannels(isAuthenticated);
  const liveActivity = useChannelStore((state) => state.activity);
  const completedChannelIds = useChannelStore((state) => state.completedChannelIds);
  const channels = machineChannels.filter(({ channel, machineId }) => {
    if (filters.workspaceId && channel.workspace_id !== filters.workspaceId) return false;
    if (
      filters.agentKind &&
      !channel.members.some(
        (member) => getAgentKindForModelId(member.model_id) === filters.agentKind,
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
  const deleteChannel = useDeleteChannelMutation();
  const renameChannel = useRenameChannelMutation();
  const isCollapsed = useUIStore((state) => state.collapsedSidebarSections.includes('channels'));
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
        notifyBackground(`/channels/${notice.channelId}`, (options) =>
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
  const [dropdown, setDropdown] = useState<{
    channel: Channel;
    position: { top: number; left: number };
  } | null>(null);
  const [channelToDelete, setChannelToDelete] = useState<Channel | null>(null);
  const [channelToRename, setChannelToRename] = useState<Channel | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useMountEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  });

  // The menu is fixed-positioned, so it would float at a stale spot once the list scrolls
  useMountEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;
    const handleScroll = () => setDropdown(null);
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
    setDropdown((prev) =>
      prev?.channel.id === channel.id
        ? null
        : { channel, position: calculateDropdownPosition(rect) },
    );
  };

  const confirmDelete = async () => {
    if (!channelToDelete) return;
    const { id } = channelToDelete;
    try {
      await mutateWithToast(
        () => deleteChannel.mutateAsync(id),
        'Channel deleted successfully',
        'Failed to delete channel',
      );
      if (id === selectedChannelId) navigate('/');
    } catch {
      // toast already shown by mutateWithToast
    } finally {
      setChannelToDelete(null);
    }
  };

  const saveRename = async (name: string) => {
    if (!channelToRename) return;
    await mutateWithToast(
      () => renameChannel.mutateAsync({ channelId: channelToRename.id, name }),
      'Channel renamed successfully',
      'Failed to rename channel',
    ).catch(() => undefined);
    setChannelToRename(null);
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
      {(isCollapsed
        ? channels.filter(({ channel }) => channel.id === selectedChannelId)
        : channels
      ).map(({ channel, machineId }) => (
        <SidebarChannelItem
          key={channel.id}
          channel={channel}
          machineBadge={machineBadge(machineId)}
          isActive={channel.id === selectedChannelId}
          isCompleted={completedChannelIds.has(channel.id)}
          isDropdownOpen={dropdown?.channel.id === channel.id}
          onSelect={navigateToChannel}
          onDropdownClick={handleDropdownClick}
        />
      ))}

      {dropdown && (
        <SidebarMenu
          ref={dropdownRef}
          position={dropdown.position}
          onClose={() => setDropdown(null)}
        >
          <SidebarMenuItem
            icon={Edit2}
            onClick={() => {
              setChannelToRename(dropdown.channel);
              setDropdown(null);
            }}
          >
            Rename
          </SidebarMenuItem>
          <SidebarMenuItem
            icon={Trash2}
            onClick={() => {
              setChannelToDelete(dropdown.channel);
              setDropdown(null);
            }}
            danger
          >
            Delete
          </SidebarMenuItem>
        </SidebarMenu>
      )}

      <ConfirmDialog
        isOpen={!!channelToDelete}
        onClose={() => setChannelToDelete(null)}
        onConfirm={confirmDelete}
        title="Delete Channel"
        message="Are you sure you want to delete this channel and its messages? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      <RenameModal
        isOpen={!!channelToRename}
        onClose={() => setChannelToRename(null)}
        onSave={saveRename}
        currentTitle={channelToRename?.name ?? ''}
        isLoading={renameChannel.isPending}
        title="Rename Channel"
      />

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
