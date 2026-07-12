import { PermissionModeSelector } from '@/components/chat/permission-mode-selector/PermissionModeSelector';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { ThinkingModeSelector } from '@/components/chat/thinking-mode-selector/ThinkingModeSelector';
import { getThinkingModesForAgent } from '@/components/chat/thinking-mode-selector/thinkingModes';
import { FastModeSelector } from '@/components/chat/fast-mode-selector/FastModeSelector';
import { PersonaSelector } from '@/components/chat/persona-selector/PersonaSelector';
import { PERSONAS_SUPPORTED_AGENTS } from '@/components/chat/persona-selector/personaSupport';
import { BranchSelector } from '@/components/chat/branch-selector/BranchSelector';
import { useInputState, useInputActions } from '@/hooks/useInputContext';
import { useAuthStore } from '@/store/authStore';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useChatContext } from '@/hooks/useChatContext';
import { useGitBranchesQuery } from '@/hooks/queries/useSandboxQueries';
import { SelectorDot } from '@/components/ui/primitives/SelectorDot/SelectorDot';
import styles from './InputControls.module.scss';

export function InputControls() {
  const state = useInputState();
  const actions = useInputActions();
  // `/models/` is auth-protected; gate so the public landing composer doesn't 401.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const modelMap = useModelMap(isAuthenticated);
  const agentKind = modelMap.get(state.selectedModelId)?.agent_kind;
  const { data: chat } = useChatQuery(state.chatId, { enabled: !!state.chatId });
  const lockedAgentKind = chat?.session_agent_kind ?? null;

  const { sandboxId, worktreeCwd, personas } = useChatContext();
  const { data: branchesData } = useGitBranchesQuery(sandboxId, !!sandboxId, worktreeCwd);

  const showPersona =
    personas.length > 0 && (!agentKind || PERSONAS_SUPPORTED_AGENTS.has(agentKind));
  const showBranch = !!sandboxId && !!branchesData?.is_git_repo && branchesData.branches.length > 0;
  // Model-aware: some agents only expose a reasoning dial on specific models
  // (e.g. Grok 4.5 but not Composer), so the base per-agent list isn't enough.
  const showThinking = agentKind
    ? getThinkingModesForAgent(agentKind, state.selectedModelId).length > 0
    : true;
  const showFastMode = agentKind === 'codex';

  return (
    <div className={styles['input-controls']} onMouseDown={(e) => e.preventDefault()}>
      <ModelSelector
        selectedModelId={state.selectedModelId}
        onModelChange={actions.onModelChange}
        dropdownPosition={state.dropdownPosition}
        dropdownAlign="right"
        disabled={state.isLoading}
        lockedAgentKind={lockedAgentKind}
        variant="text"
      />

      {showThinking && (
        <>
          <SelectorDot />

          <ThinkingModeSelector
            chatId={state.chatId}
            agentKind={agentKind}
            modelId={state.selectedModelId}
            dropdownPosition={state.dropdownPosition}
            dropdownAlign="right"
            disabled={state.isLoading}
            variant="text"
          />
        </>
      )}

      {showFastMode && (
        <>
          <SelectorDot />
          <FastModeSelector
            chatId={state.chatId}
            agentKind={agentKind}
            dropdownPosition={state.dropdownPosition}
            dropdownAlign="right"
            disabled={state.isLoading}
            variant="text"
          />
        </>
      )}

      <SelectorDot />

      <PermissionModeSelector
        chatId={state.chatId}
        agentKind={agentKind}
        dropdownPosition={state.dropdownPosition}
        dropdownAlign="right"
        disabled={state.isLoading}
        variant="text"
      />

      {showPersona && (
        <>
          <SelectorDot />
          <PersonaSelector
            chatId={state.chatId}
            dropdownPosition={state.dropdownPosition}
            dropdownAlign="right"
            disabled={state.isLoading}
            variant="text"
          />
        </>
      )}

      {showBranch && (
        <>
          <SelectorDot />
          <BranchSelector
            dropdownPosition={state.dropdownPosition}
            dropdownAlign="right"
            disabled={state.isLoading}
            variant="text"
          />
        </>
      )}
    </div>
  );
}
