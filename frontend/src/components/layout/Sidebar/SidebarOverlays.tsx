import type { Workspace } from '@/types/workspace.types';
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
  cloudWorkspaces: Workspace[] | undefined;
}

export function SidebarOverlays({
  chat,
  workspace,
  workspaces,
  cloudWorkspaces,
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
          onOpenInSplit={chat.dropdownShowSplit ? chat.handleDropdownOpenInSplit : undefined}
          splitDisabled={!chat.dropdownCanSplit}
          onClose={() => chat.setDropdown(null)}
        />
      )}

      {workspace.workspaceDropdown && (
        <WorkspaceContextMenu
          ref={workspace.workspaceDropdownRef}
          position={workspace.workspaceDropdown.position}
          onNewThread={(e) => {
            const { workspaceId, isCloud } = workspace.workspaceDropdown!;
            workspace.setWorkspaceDropdown(null);
            (isCloud ? workspace.handleNewCloudThread : workspace.handleNewWorkspaceThread)(
              e,
              workspaceId,
            );
          }}
          onRename={() => {
            const list = workspace.workspaceDropdown!.isCloud
              ? (cloudWorkspaces ?? [])
              : workspaces;
            const ws = list.find((w) => w.id === workspace.workspaceDropdown!.workspaceId);
            if (ws) workspace.handleRenameWorkspace(ws, workspace.workspaceDropdown!.isCloud);
          }}
          onDelete={() =>
            workspace.handleDeleteWorkspace(
              workspace.workspaceDropdown!.workspaceId,
              workspace.workspaceDropdown!.isCloud,
            )
          }
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
        isLoading={workspace.updateWorkspace.isPending || workspace.cloudUpdateWorkspace.isPending}
      />
    </>
  );
}
