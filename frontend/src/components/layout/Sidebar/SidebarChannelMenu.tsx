import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Edit2, Pin, PinOff, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog/ConfirmDialog';
import { RenameModal } from '@/components/ui/RenameModal/RenameModal';
import {
  useDeleteChannelMutation,
  usePinChannelMutation,
  useRenameChannelMutation,
} from '@/hooks/queries/useChannelQueries';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useUIStore } from '@/store/uiStore';
import type { Channel } from '@/types/channel.types';
import { mutateWithToast } from './sidebarHelpers';
import { SidebarMenu, SidebarMenuItem } from './SidebarMenu';

interface SidebarChannelMenuProps {
  selectedChannelId: string | null;
}

export function SidebarChannelMenu({ selectedChannelId }: SidebarChannelMenuProps) {
  const navigate = useNavigate();
  const menu = useUIStore((state) => state.channelMenu);
  const setMenu = useUIStore((state) => state.setChannelMenu);
  const deleteChannel = useDeleteChannelMutation();
  const renameChannel = useRenameChannelMutation();
  const pinChannel = usePinChannelMutation();
  const [channelToDelete, setChannelToDelete] = useState<Channel | null>(null);
  const [channelToRename, setChannelToRename] = useState<Channel | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useMountEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        !target.closest('[data-channel-menu-trigger]')
      ) {
        setMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      setMenu(null);
    };
  });

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

  const togglePin = async (channel: Channel) => {
    setMenu(null);
    const isPinned = !!channel.pinned_at;
    await mutateWithToast(
      () => pinChannel.mutateAsync({ channelId: channel.id, pinned: !isPinned }),
      isPinned ? 'Channel unpinned' : 'Channel pinned',
      'Failed to update pin status',
    ).catch(() => undefined);
  };

  const saveRename = async (name: string) => {
    if (!channelToRename) return;
    await renameChannel.mutateAsync({ channelId: channelToRename.id, name });
    toast.success('Channel renamed successfully');
    setChannelToRename(null);
  };

  return (
    <>
      {menu && (
        <SidebarMenu ref={menuRef} position={menu.position} onClose={() => setMenu(null)}>
          {menu.channel.pinned_at !== undefined && (
            <SidebarMenuItem
              icon={menu.channel.pinned_at ? PinOff : Pin}
              onClick={() => togglePin(menu.channel)}
            >
              {menu.channel.pinned_at ? 'Unpin' : 'Pin'}
            </SidebarMenuItem>
          )}
          <SidebarMenuItem
            icon={Edit2}
            onClick={() => {
              setChannelToRename(menu.channel);
              setMenu(null);
            }}
          >
            Rename
          </SidebarMenuItem>
          <SidebarMenuItem
            icon={Trash2}
            onClick={() => {
              setChannelToDelete(menu.channel);
              setMenu(null);
            }}
            danger
          >
            Delete
          </SidebarMenuItem>
        </SidebarMenu>
      )}

      <ConfirmDialog
        destructive
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
        subject="channel"
      />
    </>
  );
}
