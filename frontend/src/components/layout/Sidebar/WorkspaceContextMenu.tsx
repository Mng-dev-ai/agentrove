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
}

export function WorkspaceContextMenu({
  ref,
  position,
  onNewThread,
  onRename,
  onDelete,
  onClose,
}: WorkspaceContextMenuProps) {
  return (
    <SidebarMenu ref={ref} position={position} onClose={onClose}>
      <SidebarMenuItem icon={Plus} onClick={onNewThread}>
        New thread
      </SidebarMenuItem>
      <SidebarMenuItem icon={Edit2} onClick={onRename}>
        Rename
      </SidebarMenuItem>
      <SidebarMenuItem icon={Trash2} onClick={onDelete} danger>
        Delete
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
