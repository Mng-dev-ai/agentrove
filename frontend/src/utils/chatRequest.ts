import { coercePermissionModeForAgent } from '@/components/chat/permission-mode-selector/permissionModes';
import { coerceThinkingModeForAgent } from '@/components/chat/thinking-mode-selector/thinkingModes';
import { resolvePersona } from '@/utils/settings';
import { getAgentKindForModelId, type ChatRequest, type Model } from '@/types/chat.types';
import type { PermissionMode } from '@/store/chatSettingsStore';
import type { Persona } from '@/types/user.types';

interface RawChatSettings {
  permissionMode: PermissionMode;
  thinkingMode: string;
  worktree: boolean;
  baseBranch?: string;
  fastMode: boolean;
  persona: string;
}

type AgentChatFields = Pick<
  ChatRequest,
  | 'permission_mode'
  | 'thinking_mode'
  | 'worktree'
  | 'base_branch'
  | 'fast_mode'
  | 'selected_persona_name'
>;

// Shared coercion so local and cloud runs can't drift on agent-specific fields.
export function buildAgentChatFields(
  selectedModelId: string,
  modelMap: Map<string, Model>,
  raw: RawChatSettings,
  personas: Persona[],
): AgentChatFields {
  const agentKind =
    modelMap.get(selectedModelId)?.agent_kind ?? getAgentKindForModelId(selectedModelId);
  return {
    permission_mode: coercePermissionModeForAgent(raw.permissionMode, agentKind),
    thinking_mode: coerceThinkingModeForAgent(raw.thinkingMode, agentKind, selectedModelId),
    worktree: raw.worktree ? true : undefined,
    // Only meaningful when this turn creates a worktree; omit otherwise so a stale
    // base can't leak onto a turn that isn't cutting one.
    base_branch: raw.worktree && raw.baseBranch ? raw.baseBranch : undefined,
    // Only send when on so non-Codex agents and the Form default stay clean.
    fast_mode: agentKind === 'codex' && raw.fastMode ? true : undefined,
    selected_persona_name: resolvePersona(raw.persona, personas),
  };
}
