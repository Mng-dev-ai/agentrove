import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Hash, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog/ConfirmDialog';
import { CreateChannelDialog } from '@/components/channels/CreateChannelDialog';
import { useChannelsQuery, useDeleteChannelMutation } from '@/hooks/queries/useChannelQueries';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { stateClasses } from '@/config/stateClasses';
import type { Workspace } from '@/types/workspace.types';
import type { Channel } from '@/types/channel.types';
import { calculateDropdownPosition, mutateWithToast } from './sidebarHelpers';
import dropdownStyles from './ChatDropdown.module.scss';
import styles from './SidebarChannels.module.scss';

interface SidebarChannelsProps {
  workspaces: Workspace[];
  workspaceId: string | undefined;
  selectedChannelId: string | null;
}

export function SidebarChannels({
  workspaces,
  workspaceId: selectedWorkspaceId,
  selectedChannelId,
}: SidebarChannelsProps) {
  const workspaceId = workspaces.some((workspace) => workspace.id === selectedWorkspaceId)
    ? selectedWorkspaceId
    : undefined;
  const createWorkspaceId = workspaceId ?? workspaces[0]?.id;
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { data: channels = [] } = useChannelsQuery(workspaceId, isAuthenticated);
  const deleteChannel = useDeleteChannelMutation();

  const [createOpen, setCreateOpen] = useState(false);
  const [dropdown, setDropdown] = useState<{
    channel: Channel;
    position: { top: number; left: number };
  } | null>(null);
  const [channelToDelete, setChannelToDelete] = useState<Channel | null>(null);
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

  return (
    <div className={styles.channels}>
      <div className={styles.header}>
        <span className={styles.title}>Channels</span>
        <Button
          variant="unstyled"
          onClick={() => setCreateOpen(true)}
          disabled={!createWorkspaceId}
          className={styles['new-btn']}
          aria-label="New channel"
        >
          <Plus className={styles['new-icon']} />
        </Button>
      </div>
      {channels.map((channel) => {
        const isActive = channel.id === selectedChannelId;
        return (
          <div key={channel.id} className={clsx(styles.item, isActive && stateClasses.ACTIVE)}>
            <Button
              variant="unstyled"
              onClick={() => navigateToChannel(channel.id)}
              aria-current={isActive ? 'page' : undefined}
              className={styles['item-btn']}
            >
              <Hash className={styles['item-icon']} />
              <span className={styles['item-name']}>{channel.name}</span>
            </Button>
            <Button
              variant="unstyled"
              onClick={(e) => handleDropdownClick(e, channel)}
              onMouseDown={(e) => e.stopPropagation()}
              className={clsx(
                styles['dropdown-btn'],
                (isActive || dropdown?.channel.id === channel.id) &&
                  styles['dropdown-btn--visible'],
              )}
              aria-label="Channel options"
            >
              <MoreHorizontal className={styles['dropdown-icon']} />
            </Button>
          </div>
        );
      })}

      {dropdown && (
        <div
          ref={dropdownRef}
          role="menu"
          className={dropdownStyles['chat-dropdown']}
          style={{ top: `${dropdown.position.top}px`, left: `${dropdown.position.left}px` }}
        >
          <Button
            onClick={() => {
              setChannelToDelete(dropdown.channel);
              setDropdown(null);
            }}
            role="menuitem"
            variant="unstyled"
            className={dropdownStyles['menu-item-delete']}
          >
            <Trash2 className={dropdownStyles.icon} />
            Delete
          </Button>
        </div>
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

      {createOpen && createWorkspaceId && (
        <CreateChannelDialog
          workspaceId={createWorkspaceId}
          onClose={() => setCreateOpen(false)}
          onCreated={navigateToChannel}
        />
      )}
    </div>
  );
}
