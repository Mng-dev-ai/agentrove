import { useContext } from 'react';
import { createPortal } from 'react-dom';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useMachineWorkspacesQuery } from '@/hooks/queries/useMachineQueries';
import { useChatMachineId } from '@/store/machineOrigin';
import { useUIStore } from '@/store/uiStore';
import { SessionPanelSlotContext } from '@/contexts/SessionPanelSlotContext';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { Chat } from '@/types/chat.types';
import type { AgentTileId } from '@/types/ui.types';
import { SessionPanel } from './SessionPanel';
import styles from './SessionPanel.module.scss';

export function SessionPanelSlot({ ref }: { ref: (el: HTMLDivElement | null) => void }) {
  return <div ref={ref} className={styles.slot} />;
}

function ChatSessionPanel({ chat }: { chat: Chat }) {
  const workspaces = useWorkspacesList();
  const machineId = useChatMachineId(chat.id);
  const isRemote = machineId !== LOCAL_MACHINE_ID;
  const { data: machineWorkspaces } = useMachineWorkspacesQuery(machineId, isRemote);
  const workspace = (isRemote ? machineWorkspaces : workspaces)?.find(
    (w) => w.id === chat.workspace_id,
  );
  return <SessionPanel chat={chat} workspace={workspace} />;
}

export function PaneSessionPanel({
  agentTile,
  chat,
}: {
  agentTile: AgentTileId;
  chat: Chat | undefined;
}) {
  const slot = useContext(SessionPanelSlotContext);
  const shown = useUIStore((s) => s.activeAgentTile === agentTile);
  if (!slot || !shown || !chat) return null;
  return createPortal(<ChatSessionPanel chat={chat} />, slot);
}
