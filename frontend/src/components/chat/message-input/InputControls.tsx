import clsx from 'clsx';
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
import { useChatContext } from '@/hooks/useChatContext';
import { useGitBranchesQuery } from '@/hooks/queries/useSandboxQueries';
import { SelectorDot } from '@/components/ui/primitives/SelectorDot/SelectorDot';
import { ContextUsageIndicator } from './ContextUsageIndicator';
import styles from './InputControls.module.scss';

function useSelectedModel() {
  const state = useInputState();
  // `/models/` is auth-protected; gate so the public landing composer doesn't 401.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const modelMap = useModelMap({ enabled: isAuthenticated, machineId: state.machineId });
  const selectedModel = modelMap.get(state.selectedModelId);
  return { selectedModel, agentKind: selectedModel?.agent_kind };
}

// Keeps focus in the textarea while a trigger is clicked
const preventBlur = (e: React.MouseEvent) => e.preventDefault();

export function ModelControls() {
  const state = useInputState();
  const actions = useInputActions();
  const { selectedModel, agentKind } = useSelectedModel();
  // Model-aware: some agents only expose a reasoning dial on specific models
  // (e.g. Claude's Haiku has none), so the base per-agent list isn't enough.
  const showThinking = agentKind
    ? getThinkingModesForAgent(agentKind, selectedModel).length > 0
    : true;

  return (
    <div className={clsx(styles.group, styles['group--field'])} onMouseDown={preventBlur}>
      <ModelSelector
        selectedModelId={state.selectedModelId}
        onModelChange={actions.onModelChange}
        dropdownPosition={state.dropdownPosition}
        dropdownAlign="right"
        disabled={state.isLoading}
        variant="text"
        machineId={state.machineId}
      />

      {showThinking && (
        <>
          <SelectorDot />
          <ThinkingModeSelector
            chatId={state.chatId}
            agentKind={agentKind}
            model={selectedModel}
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

export function ComposerFooter() {
  const state = useInputState();
  const { agentKind } = useSelectedModel();

  const { sandboxId, worktreeCwd, personas } = useChatContext();
  const { data: branchesData } = useGitBranchesQuery(sandboxId, !!sandboxId, worktreeCwd);

  const showPersona =
    personas.length > 0 && (!agentKind || PERSONAS_SUPPORTED_AGENTS.has(agentKind));
  const showBranch =
    state.showBranch &&
    !!sandboxId &&
    !!branchesData?.is_git_repo &&
    branchesData.branches.length > 0;
  const showFastMode = agentKind === 'codex';

  return (
    <div className={styles.footer} onMouseDown={preventBlur}>
      {showBranch && (
        <BranchSelector
          dropdownPosition={state.dropdownPosition}
          dropdownAlign="left"
          disabled={state.isLoading}
          variant="text"
        />
      )}

      <div className={styles['footer-end']}>
        <div className={styles.group}>
          {showFastMode && (
            <>
              <FastModeSelector
                chatId={state.chatId}
                agentKind={agentKind}
                dropdownPosition={state.dropdownPosition}
                dropdownAlign="right"
                disabled={state.isLoading}
                variant="text"
              />
              <SelectorDot />
            </>
          )}

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
        </div>

        {state.contextUsage && <ContextUsageIndicator usage={state.contextUsage} />}
      </div>
    </div>
  );
}
