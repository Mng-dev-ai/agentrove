import type { ReactNode } from 'react';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useMachineWorkspacesQuery } from '@/hooks/queries/useMachineQueries';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useSessionPanelOpen } from '@/hooks/useSessionPanelOpen';
import { useChatMachineId } from '@/store/machineOrigin';
import { useUIStore } from '@/store/uiStore';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { Chat } from '@/types/chat.types';
import type { AgentTileId } from '@/types/ui.types';
import { SessionPanel } from './SessionPanel';
import styles from './SessionPanel.module.scss';

export function ChatSessionPanel({ chat }: { chat: Chat }) {
  const workspaces = useWorkspacesList();
  const machineId = useChatMachineId(chat.id);
  const isRemote = machineId !== LOCAL_MACHINE_ID;
  const { data: machineWorkspaces } = useMachineWorkspacesQuery(machineId, isRemote);
  const workspace = (isRemote ? machineWorkspaces : workspaces)?.find(
    (w) => w.id === chat.workspace_id,
  );
  return <SessionPanel chat={chat} workspace={workspace} />;
}

// Phones show the routed chat's panel over the whole workspace instead (WorkspaceSurface).
export function PaneSessionPanel({
  agentTile,
  chat,
  children,
}: {
  agentTile: AgentTileId;
  chat: Chat | undefined;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  const open = useSessionPanelOpen(agentTile);
  return (
    <div className={styles.pane}>
      {children}
      {open && !isMobile && chat && (
        // Panel actions resolve their chat from the active pane, keyboard activation included.
        <div
          className={styles['pane-panel']}
          onClickCapture={() => useUIStore.getState().focusTile(agentTile)}
        >
          <ChatSessionPanel chat={chat} />
        </div>
      )}
    </div>
  );
}
