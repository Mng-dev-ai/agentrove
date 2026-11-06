import { type Ref } from 'react';
import { Edit2, Plus, Trash2 } from 'lucide-react';
import { SidebarMenu, SidebarMenuItem } from './SidebarMenu';

interface WorkspaceContextMenuProps {
  ref?: Ref<HTMLDivElement>;
  position: { top: number; left: number };
  onNewThread: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
  disabled: boolean;
}

export function WorkspaceContextMenu({
  ref,
  position,
  onNewThread,
  onRename,
  onDelete,
  onClose,
  disabled,
}: WorkspaceContextMenuProps) {
  return (
    <SidebarMenu ref={ref} position={position} onClose={onClose}>
      <SidebarMenuItem icon={Plus} onClick={onNewThread} disabled={disabled}>
        New thread
      </SidebarMenuItem>
      <SidebarMenuItem icon={Edit2} onClick={onRename} disabled={disabled}>
        Rename
      </SidebarMenuItem>
      <SidebarMenuItem icon={Trash2} onClick={onDelete} danger disabled={disabled}>
        Delete
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
