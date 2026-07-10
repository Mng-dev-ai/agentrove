import type { AgentKind } from '@/types/chat.types';

// Claude and Codex expose direct prompt-replacement hooks; OpenCode uses a
// generated primary agent with the persona prompt; Grok accepts a
// systemPromptOverride on session/new. Cursor and Copilot ignore prompt
// replacement over ACP, so personas are hidden for those agents.
export const PERSONAS_SUPPORTED_AGENTS: ReadonlySet<AgentKind> = new Set<AgentKind>([
  'claude',
  'codex',
  'grok',
  'opencode',
]);
