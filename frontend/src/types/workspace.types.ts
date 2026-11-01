import type { SandboxProviderType } from './user.types';
import type { AgentKind } from './chat.types';
import type { SlashCommand } from './ui.types';

export type WorkspaceSourceType = 'git' | 'local' | 'empty';

export interface Workspace {
  id: string;
  name: string;
  user_id: string;
  sandbox_id: string;
  sandbox_provider: SandboxProviderType;
  workspace_path: string;
  source_type?: string | null;
  source_url?: string | null;
  created_at: string;
  updated_at: string;
  chat_count: number;
  last_chat_at: string | null;
}

export interface CreateWorkspaceRequest {
  name: string;
  source_type: WorkspaceSourceType;
  workspace_path?: string;
  git_url?: string;
  sandbox_provider: SandboxProviderType;
}

export interface UpdateWorkspaceRequest {
  name?: string;
}

export interface WorkspaceResources {
  builtin_slash_commands: Record<AgentKind, SlashCommand[]>;
}
