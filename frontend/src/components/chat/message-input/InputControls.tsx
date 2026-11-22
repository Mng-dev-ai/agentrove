import clsx from 'clsx';
import { PermissionModeSelector } from '@/components/chat/permission-mode-selector/PermissionModeSelector';
import { ModelSelector } from '@/components/chat/model-selector/ModelSelector';
import { ThinkingModeSelector } from '@/components/chat/thinking-mode-selector/ThinkingModeSelector';
import { FastModeSelector } from '@/components/chat/fast-mode-selector/FastModeSelector';
import { PersonaSelector } from '@/components/chat/persona-selector/PersonaSelector';
import { BranchSelector } from '@/components/chat/branch-selector/BranchSelector';
import { useInputState, useInputActions } from '@/hooks/useInputContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatContext } from '@/hooks/useChatContext';
import { useGitBranchesQuery } from '@/hooks/queries/useSandboxQueries';
import { SelectorDot } from '@/components/ui/primitives/SelectorDot/SelectorDot';
import { ContextUsageIndicator } from './ContextUsageIndicator';
import { MobileComposerSettings } from './ComposerSettings';
import { preventBlur, useComposerSettings } from './useComposerSettings';
import styles from './InputControls.module.scss';

export function ModelControls() {
  const state = useInputState();
  const actions = useInputActions();
  const settings = useComposerSettings();
  const isMobile = useIsMobile();
  const { selectedModel, agentKind, showThinking } = settings;

  if (isMobile) return <MobileComposerSettings settings={settings} />;

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
  const { agentKind, showPersona, showFastMode } = useComposerSettings();
  const isMobile = useIsMobile();

  const { sandboxId, worktreeCwd } = useChatContext();
  const { data: branchesData } = useGitBranchesQuery(sandboxId, !!sandboxId, worktreeCwd);

  const showBranch =
    state.showBranch &&
    !!sandboxId &&
    !!branchesData?.is_git_repo &&
    branchesData.branches.length > 0;

  if (isMobile && !showBranch && !state.contextUsage) {
    return <div className={clsx(styles.footer, styles['footer--bare'])} />;
  }

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
        {!isMobile && (
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
        )}

        {state.contextUsage && <ContextUsageIndicator usage={state.contextUsage} />}
      </div>
    </div>
  );
}
