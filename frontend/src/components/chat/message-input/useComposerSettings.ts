import { getThinkingModesForAgent } from '@/components/chat/thinking-mode-selector/thinkingModes';
import { useInputState } from '@/hooks/useInputContext';
import { useAuthStore } from '@/store/authStore';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import { useChatContext } from '@/hooks/useChatContext';
import { supportsFastMode, supportsPersona } from '@/types/chat.types';

export function useComposerSettings() {
  const state = useInputState();
  // `/models/` is auth-protected; gate so the public landing composer doesn't 401.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const modelMap = useModelMap({ enabled: isAuthenticated, machineId: state.machineId });
  const { personas } = useChatContext();
  const selectedModel = modelMap.get(state.selectedModelId);
  const agentKind = selectedModel?.agent_kind;
  return {
    selectedModel,
    agentKind,
    // Model-aware: some agents only expose a reasoning dial on specific models
    // (e.g. Claude's Haiku has none), so the base per-agent list isn't enough.
    showThinking: agentKind ? getThinkingModesForAgent(agentKind, selectedModel).length > 0 : true,
    showPersona: personas.length > 0 && (!agentKind || supportsPersona(selectedModel, agentKind)),
    showFastMode: supportsFastMode(selectedModel, agentKind),
  };
}

export type ComposerSettingsInfo = ReturnType<typeof useComposerSettings>;

// Keeps focus in the textarea while a trigger is clicked
export const preventBlur = (e: React.MouseEvent) => e.preventDefault();
