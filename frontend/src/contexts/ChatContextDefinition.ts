import { createContext } from 'react';
import type { FileStructure } from '@/types/file-system.types';
import type { CustomSkill, Persona } from '@/types/user.types';
import type { SlashCommand } from '@/types/ui.types';
import type { AgentKind } from '@/types/chat.types';

interface ChatContextValue {
  chatId: string | undefined;
  sandboxId: string | undefined;
  worktreeCwd: string | undefined;
  parentChatId: string | undefined;
  fileStructure: FileStructure[];
  customSkills: CustomSkill[];
  builtinSlashCommands: Record<AgentKind, SlashCommand[]>;
  personas: Persona[];
}

export const ChatContext = createContext<ChatContextValue | null>(null);
