import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Edit2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog/ConfirmDialog';
import { RenameModal } from '@/components/ui/RenameModal/RenameModal';
import { CreateChannelDialog } from '@/components/channels/CreateChannelDialog';
import {
  useChannelsQuery,
  useDeleteChannelMutation,
  useRenameChannelMutation,
} from '@/hooks/queries/useChannelQueries';
import { useMountEffect } from '@/hooks/useMountEffect';
import { apiClient } from '@/lib/api';
import '@/services/streamService';
import { streamConnection } from '@/services/streamConnection';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import type { Workspace } from '@/types/workspace.types';
import type { Channel } from '@/types/channel.types';
import { calculateDropdownPosition, mutateWithToast } from './sidebarHelpers';
import { SidebarChannelItem } from './SidebarChannelItem';
import { SidebarMenu, SidebarMenuItem } from './SidebarMenu';
import { SidebarSectionHeader } from './SidebarSectionHeader';
import styles from './SidebarChannels.module.scss';

interface SidebarChannelsProps {
  workspaces: Workspace[];
  workspaceId: string | undefined;
  filterWorkspaceId: string | null;
  selectedChannelId: string | null;
}

export function SidebarChannels({
  workspaces,
  workspaceId: selectedWorkspaceId,
  filterWorkspaceId,
  selectedChannelId,
}: SidebarChannelsProps) {
  const workspaceId = workspaces.some((workspace) => workspace.id === selectedWorkspaceId)
    ? selectedWorkspaceId
    : undefined;
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { data: channels = [] } = useChannelsQuery(filterWorkspaceId ?? undefined, isAuthenticated);
  const deleteChannel = useDeleteChannelMutation();
  const renameChannel = useRenameChannelMutation();
  const hasChannels = channels.length > 0;

  useEffect(() => {
    if (hasChannels) return streamConnection.retain(apiClient);
  }, [hasChannels]);

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
      <SidebarSectionHeader title="Channels">
        <Button
          variant="unstyled"
          onClick={() => setCreateOpen(true)}
          className={styles['new-btn']}
          aria-label="New channel"
        >
          <Plus className={styles['new-icon']} />
        </Button>
      </SidebarSectionHeader>
      <div className={styles.list}>
        {channels.map((channel) => (
          <SidebarChannelItem
            key={channel.id}
            channel={channel}
            isActive={channel.id === selectedChannelId}
            isDropdownOpen={dropdown?.channel.id === channel.id}
            onSelect={navigateToChannel}
            onDropdownClick={handleDropdownClick}
          />
        ))}
      </div>

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
