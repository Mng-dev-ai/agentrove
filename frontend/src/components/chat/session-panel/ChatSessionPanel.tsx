import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useMachineWorkspacesQuery } from '@/hooks/queries/useMachineQueries';
import { useChatMachineId } from '@/store/machineOrigin';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { Chat } from '@/types/chat.types';
import { SessionPanel } from './SessionPanel';

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
