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
import { getRelativeTime } from '@/utils/date';
import type { Workspace } from '@/types/workspace.types';
import type { Channel } from '@/types/channel.types';
import { calculateDropdownPosition, mutateWithToast } from './sidebarHelpers';
import dropdownStyles from './ChatDropdown.module.scss';
import filterStyles from './SidebarFilterMenu.module.scss';
import itemStyles from './SidebarChatItem.module.scss';
import listStyles from './SidebarChatList.module.scss';
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
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { data: channels = [] } = useChannelsQuery(workspaceId, isAuthenticated);
  const deleteChannel = useDeleteChannelMutation();

  const [createOpen, setCreateOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
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
      <div className={listStyles['recents-header']}>
        <span className={listStyles['section-title']}>Channels</span>
        <Button
          variant="unstyled"
          onClick={() => setCreateOpen(true)}
          className={filterStyles.trigger}
          aria-label="New channel"
        >
          <Plus className={filterStyles['trigger-icon']} />
        </Button>
      </div>
      <div className={listStyles.section}>
        {channels.map((channel) => {
          const isActive = channel.id === selectedChannelId;
          const isRevealed =
            isActive || hoveredId === channel.id || dropdown?.channel.id === channel.id;
          return (
            <div
              key={channel.id}
              className={clsx(itemStyles['chat-item'], isActive && stateClasses.ACTIVE)}
              onMouseEnter={() => setHoveredId(channel.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div className={itemStyles['title-col']}>
                <div className={itemStyles['title-row']}>
                  <span className={itemStyles['status-slot']}>
                    <Hash className={itemStyles['provider-icon']} />
                  </span>
                  <Button
                    variant="unstyled"
                    onClick={() => navigateToChannel(channel.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={itemStyles['title-btn']}
                  >
                    <span
                      className={clsx(
                        itemStyles['title-text'],
                        isActive && itemStyles['title-text--emphasis'],
                      )}
                    >
                      {channel.name}
                    </span>
                  </Button>
                </div>
                <span
                  className={clsx(
                    itemStyles['workspace-badge'],
                    itemStyles['workspace-badge--indented'],
                  )}
                >
                  <span className={itemStyles['workspace-name']}>
                    {channel.members.map((member) => member.display_name).join(', ')}
                  </span>
                </span>
              </div>
              <span
                className={clsx(
                  itemStyles.timestamp,
                  isRevealed && itemStyles['timestamp--hidden'],
                )}
              >
                {getRelativeTime(channel.updated_at)}
              </span>
              <Button
                variant="unstyled"
                onClick={(e) => handleDropdownClick(e, channel)}
                onMouseDown={(e) => e.stopPropagation()}
                className={clsx(
                  itemStyles['dropdown-btn'],
                  isRevealed && itemStyles['dropdown-btn--visible'],
                )}
                aria-label="Channel options"
              >
                <MoreHorizontal className={itemStyles['dropdown-icon']} />
              </Button>
            </div>
          );
        })}
      </div>

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
