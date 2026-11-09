import { type ReactNode, useMemo } from 'react';
import type { FileStructure } from '@/types/file-system.types';
import type { Persona } from '@/types/user.types';
import type { SlashCommand } from '@/types/ui.types';
import type { AgentKind } from '@/types/chat.types';
import type { Workspace } from '@/types/workspace.types';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import { useChatMachineId } from '@/store/machineOrigin';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { useMachineWorkspacesQuery } from '@/hooks/queries/useMachineQueries';
import { ChatContext } from './ChatContextDefinition';
import { EMPTY_BUILTIN_COMMANDS } from '@/config/constants';

const EMPTY_FILES: FileStructure[] = [];
const EMPTY_PERSONAS: Persona[] = [];
const EMPTY_WORKSPACES: Workspace[] = [];

interface ChatProviderProps {
  chatId?: string;
  sandboxId?: string;
  worktreeCwd?: string;
  parentChatId?: string;
  fileStructure?: FileStructure[] | null;
  builtinSlashCommands?: Record<AgentKind, SlashCommand[]> | null;
  personas?: Persona[] | null;
  children: ReactNode;
}

export function ChatProvider({
  chatId,
  sandboxId,
  worktreeCwd,
  parentChatId,
  fileStructure,
  builtinSlashCommands,
  personas,
  children,
}: ChatProviderProps) {
  const resolvedFileStructure = fileStructure ?? EMPTY_FILES;
  const resolvedBuiltinSlashCommands = builtinSlashCommands ?? EMPTY_BUILTIN_COMMANDS;
  const resolvedPersonas = personas ?? EMPTY_PERSONAS;
  const machineId = useChatMachineId(chatId);
  const isRemote = machineId !== LOCAL_MACHINE_ID;
  const localWorkspaces = useWorkspacesList();
  const { data: machineWorkspaces } = useMachineWorkspacesQuery(machineId, isRemote);
  const workspaces = isRemote ? (machineWorkspaces ?? EMPTY_WORKSPACES) : localWorkspaces;

  const value = useMemo(
    () => ({
      chatId,
      sandboxId,
      worktreeCwd,
      parentChatId,
      fileStructure: resolvedFileStructure,
      workspaces,
      builtinSlashCommands: resolvedBuiltinSlashCommands,
      personas: resolvedPersonas,
    }),
    [
      chatId,
      sandboxId,
      worktreeCwd,
      parentChatId,
      resolvedFileStructure,
      workspaces,
      resolvedBuiltinSlashCommands,
      resolvedPersonas,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
