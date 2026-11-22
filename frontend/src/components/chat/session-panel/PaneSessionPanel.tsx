import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PanelHeader } from '@/components/layout/PaneHeader/PaneHeader';
import { SessionPanelSlotContext } from '@/contexts/SessionPanelSlotContext';
import { createContextHook } from '@/hooks/createContextHook';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useMachineWorkspacesQuery } from '@/hooks/queries/useMachineQueries';
import { useChatMachineId } from '@/store/machineOrigin';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { Chat } from '@/types/chat.types';
import type { AgentTileId } from '@/types/ui.types';
import { SessionPanel } from './SessionPanel';
import styles from './SessionPanel.module.scss';

type Slots = Partial<Record<AgentTileId, HTMLElement>>;

const useSessionPanelSlots = createContextHook(
  SessionPanelSlotContext,
  'useSessionPanelSlots',
  'SessionPanelSlotsProvider',
);

export function SessionPanelSlotsProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Slots>({});
  const register = useCallback((agentTile: AgentTileId, el: HTMLElement) => {
    setSlots((prev) => ({ ...prev, [agentTile]: el }));
    return () =>
      setSlots((prev) => (prev[agentTile] === el ? { ...prev, [agentTile]: undefined } : prev));
  }, []);
  const value = useMemo(() => ({ slots, register }), [slots, register]);
  return (
    <SessionPanelSlotContext.Provider value={value}>{children}</SessionPanelSlotContext.Provider>
  );
}

// Where a pane's panel shows; the pane portals it in so it reads that pane's session state.
export function PaneSessionPanelSlot({
  agentTile,
  headed,
}: {
  agentTile: AgentTileId;
  headed: boolean;
}) {
  const { register } = useSessionPanelSlots();
  const ref = useCallback((el: HTMLDivElement) => register(agentTile, el), [register, agentTile]);
  return (
    <div className={styles.slot}>
      {headed && <PanelHeader agentTile={agentTile} inTile />}
      <div ref={ref} className={styles['slot-body']} />
    </div>
  );
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
  const slot = useSessionPanelSlots().slots[agentTile];
  if (!slot || !chat) return null;
  return createPortal(<ChatSessionPanel chat={chat} />, slot);
}
