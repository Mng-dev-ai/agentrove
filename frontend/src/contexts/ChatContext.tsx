import { type ReactNode, useMemo } from 'react';
import type { FileStructure } from '@/types/file-system.types';
import type { Persona } from '@/types/user.types';
import type { SlashCommand } from '@/types/ui.types';
import type { AgentKind } from '@/types/chat.types';
import { useChatMachineId } from '@/store/machineOrigin';
import { useAuthStore } from '@/store/authStore';
import { useWorkspacesList } from '@/hooks/queries/useWorkspaceQueries';
import { ChatContext } from './ChatContextDefinition';
import { EMPTY_BUILTIN_COMMANDS } from '@/config/constants';

const EMPTY_FILES: FileStructure[] = [];
const EMPTY_PERSONAS: Persona[] = [];

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
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const workspaces = useWorkspacesList({
    machineId: useChatMachineId(chatId),
    enabled: isAuthenticated,
  });

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
