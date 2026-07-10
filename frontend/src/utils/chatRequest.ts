import { coercePermissionModeForAgent } from '@/components/chat/permission-mode-selector/permissionModes';
import { coerceThinkingModeForAgent } from '@/components/chat/thinking-mode-selector/thinkingModes';
import { resolvePersona } from '@/utils/settings';
import { getAgentKindForModelId, type ChatRequest, type Model } from '@/types/chat.types';
import type { PermissionMode } from '@/store/chatSettingsStore';
import type { Persona } from '@/types/user.types';

// Raw toolbar settings before agent coercion.
interface RawChatSettings {
  permissionMode: PermissionMode;
  thinkingMode: string;
  worktree: boolean;
  persona: string;
}

type AgentChatFields = Pick<
  ChatRequest,
  'permission_mode' | 'thinking_mode' | 'worktree' | 'selected_persona_name'
>;

// Coerce raw toolbar settings into the agent-specific ChatRequest fields. Shared
// so local (useMessageActions) and cloud (landing) runs start with identical
// behavior — the coercion rules can't drift between the two paths.
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
    selected_persona_name: resolvePersona(raw.persona, personas),
  };
}
