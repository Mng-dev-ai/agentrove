import type { Workspace } from '@/types/workspace.types';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog/ConfirmDialog';
import { RenameModal } from '@/components/ui/RenameModal/RenameModal';
import { ChatDropdown } from './ChatDropdown';
import { WorkspaceContextMenu } from './WorkspaceContextMenu';
import type { SidebarChatActions } from './useSidebarChatActions';
import type { SidebarWorkspaceActions } from './useSidebarWorkspaceActions';

interface SidebarOverlaysProps {
  chat: SidebarChatActions;
  workspace: SidebarWorkspaceActions;
  workspaces: Workspace[];
  machineWorkspaces: Record<string, Workspace[]>;
}

export function SidebarOverlays({
  chat,
  workspace,
  workspaces,
  machineWorkspaces,
}: SidebarOverlaysProps) {
  return (
    <>
      {chat.dropdown && (
        <ChatDropdown
          ref={chat.dropdownRef}
          chat={chat.dropdown.chat}
          position={chat.dropdown.position}
          onRename={chat.handleRenameClick}
          onDelete={chat.handleDeleteChat}
          onTogglePin={chat.handleTogglePin}
          onWorkspaceOptions={(target) => {
            const { position } = chat.dropdown!;
            chat.setDropdown(null);
            workspace.openWorkspaceMenu(target.workspace_id, position);
          }}
          onOpenInSplit={chat.dropdownShowSplit ? chat.handleDropdownOpenInSplit : undefined}
          splitDisabled={!chat.dropdownCanSplit}
          onClose={() => chat.setDropdown(null)}
        />
      )}

      {workspace.workspaceDropdown && (
        <WorkspaceContextMenu
          ref={workspace.workspaceDropdownRef}
          position={workspace.workspaceDropdown.position}
          onNewThread={() => {
            const { workspaceId, machineId } = workspace.workspaceDropdown!;
            workspace.setWorkspaceDropdown(null);
            workspace.handleNewWorkspaceThread(workspaceId, machineId);
          }}
          onRename={() => {
            const { workspaceId, machineId } = workspace.workspaceDropdown!;
            const list =
              machineId === LOCAL_MACHINE_ID ? workspaces : (machineWorkspaces[machineId] ?? []);
            const ws = list.find((w) => w.id === workspaceId);
            if (ws) workspace.handleRenameWorkspace(ws, machineId);
          }}
          onDelete={() =>
            workspace.handleDeleteWorkspace(
              workspace.workspaceDropdown!.workspaceId,
              workspace.workspaceDropdown!.machineId,
            )
          }
          onClose={() => workspace.setWorkspaceDropdown(null)}
        />
      )}

      <ConfirmDialog
        isOpen={!!chat.chatToDelete}
        onClose={() => chat.setChatToDelete(null)}
        onConfirm={chat.confirmDeleteChat}
        title="Delete Chat"
        message="Are you sure you want to delete this chat? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      <ConfirmDialog
        isOpen={!!workspace.workspaceToDelete}
        onClose={() => workspace.setWorkspaceToDelete(null)}
        onConfirm={workspace.confirmDeleteWorkspace}
        title="Delete Workspace"
        message="Are you sure you want to delete this workspace and all its chats? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      <RenameModal
        isOpen={!!chat.chatToRename}
        onClose={() => chat.setChatToRename(null)}
        onSave={chat.handleSaveRename}
        currentTitle={chat.chatToRename?.title || ''}
        isLoading={chat.updateChat.isPending}
        onGenerateTitle={chat.handleGenerateChatTitle}
        isGenerating={chat.generateChatTitle.isPending}
      />

      <RenameModal
        isOpen={!!workspace.workspaceToRename}
        onClose={() => workspace.setWorkspaceToRename(null)}
        onSave={workspace.handleSaveWorkspaceRename}
        currentTitle={workspace.workspaceToRename?.workspace.name || ''}
        isLoading={
          workspace.updateWorkspace.isPending || workspace.machineUpdateWorkspace.isPending
        }
      />
    </>
  );
}
