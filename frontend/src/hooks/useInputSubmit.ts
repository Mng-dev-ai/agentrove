import { useCallback, type RefObject } from 'react';
import toast from 'react-hot-toast';
import { queryClient } from '@/lib/queryClient';
import { fetchAutoSteerQueuedMessages } from '@/hooks/queries/useSettingsQueries';
import { sendQueuedMessageNow, useMessageQueueStore } from '@/store/messageQueueStore';
import { useUIStore, type ComposerSelection } from '@/store/uiStore';
import { formatComposerSelections } from '@/utils/composerSelections';
import { coercePermissionModeForAgent } from '@/components/chat/permission-mode-selector/permissionModes';
import { coerceThinkingModeForAgent } from '@/components/chat/thinking-mode-selector/thinkingModes';
import {
  useChatSettingsStore,
  DEFAULT_PERMISSION_MODE,
  DEFAULT_THINKING_MODE,
  DEFAULT_WORKTREE,
  DEFAULT_FAST_MODE,
  DEFAULT_PERSONA,
} from '@/store/chatSettingsStore';
import { resolvePersona } from '@/utils/settings';
import { useTokenDeleteKeyDown } from '@/hooks/useComposerTokens';
import type { Persona } from '@/types/user.types';
import type { AgentKind, Model } from '@/types/chat.types';

interface UseInputSubmitOptions {
  disabled: boolean;
  hasContent: boolean;
  onSubmit: (e: React.FormEvent) => void;
  setPreviewDismissed: React.Dispatch<React.SetStateAction<boolean>>;
  isStreaming: boolean;
  onStopStream?: () => void;
  isLoading: boolean;
  chatId?: string;
  selectedModelId: string;
  selectedModel: Model | undefined;
  agentKind: AgentKind;
  personas: Persona[];
  attachedSelections: ComposerSelection[];
  attachedFiles: File[] | null;
  messageRef: RefObject<string>;
  setMessage: (value: string) => void;
  onAttach?: (files: File[]) => void;
  formRef: RefObject<HTMLFormElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  handleMentionKeyDown: (e: React.KeyboardEvent<Element>) => boolean;
  handleSlashCommandKeyDown: (e: React.KeyboardEvent<Element>) => boolean;
}

// Submit/stop/queue logic plus the keyboard wiring around it — Enter-to-send,
// suggestion-aware key handling, token-pill deletion, and selection removal.
export function useInputSubmit({
  disabled,
  hasContent,
  onSubmit,
  setPreviewDismissed,
  isStreaming,
  onStopStream,
  isLoading,
  chatId,
  selectedModelId,
  selectedModel,
  agentKind,
  personas,
  attachedSelections,
  attachedFiles,
  messageRef,
  setMessage,
  onAttach,
  formRef,
  textareaRef,
  handleMentionKeyDown,
  handleSlashCommandKeyDown,
}: UseInputSubmitOptions) {
  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (disabled) return;
      if (!hasContent) return;

      setPreviewDismissed(true);
      onSubmit(event);
    },
    [disabled, hasContent, onSubmit, setPreviewDismissed],
  );

  const submitOrStop = useCallback(() => {
    if (isStreaming && !hasContent) {
      onStopStream?.();
      return;
    }

    if (disabled) return;

    if (isStreaming && hasContent && chatId) {
      // Fire-and-forget queue + clear draft — guard model or the message is lost.
      if (!selectedModelId) {
        toast.error('Please select an AI model');
        return;
      }
      const settings = useChatSettingsStore.getState();
      const permissionMode = coercePermissionModeForAgent(
        settings.permissionModeByChat[chatId] ?? DEFAULT_PERMISSION_MODE,
        agentKind,
      );
      const thinkingMode = coerceThinkingModeForAgent(
        settings.thinkingModeByChat[chatId] ?? DEFAULT_THINKING_MODE,
        agentKind,
        selectedModel,
      );
      const worktree = settings.worktreeByChat[chatId] ?? DEFAULT_WORKTREE;
      const baseBranch = settings.worktreeBaseBranchByChat[chatId];
      const fastMode = settings.fastModeByChat[chatId] ?? DEFAULT_FAST_MODE;
      const storedPersona = settings.personaByChat[chatId] ?? DEFAULT_PERSONA;
      const validPersona = resolvePersona(storedPersona, personas);
      const fullMessage = formatComposerSelections(attachedSelections, messageRef.current.trim());
      void useMessageQueueStore
        .getState()
        .queueMessage(chatId, fullMessage, selectedModelId, {
          permissionMode,
          thinkingMode,
          worktree,
          baseBranch,
          fastMode,
          selectedPersonaName: validPersona,
          files: attachedFiles ?? undefined,
        })
        .then(async (messageId) => {
          if (await fetchAutoSteerQueuedMessages(queryClient)) {
            await sendQueuedMessageNow(chatId, messageId);
          }
        });
      setMessage('');
      onAttach?.([]);
      if (attachedSelections.length > 0) useUIStore.getState().clearComposerSelections(chatId);
      setPreviewDismissed(true);
      return;
    }

    if (isLoading) {
      onStopStream?.();
      return;
    }

    if (!hasContent) return;

    setPreviewDismissed(true);

    const formElement = formRef.current;
    if (formElement && typeof formElement.requestSubmit === 'function') {
      formElement.requestSubmit();
      return;
    }

    const formEvent = new Event('submit', {
      bubbles: true,
      cancelable: true,
    }) as unknown as React.FormEvent;
    onSubmit(formEvent);
  }, [
    disabled,
    hasContent,
    isLoading,
    isStreaming,
    onStopStream,
    onSubmit,
    chatId,
    attachedFiles,
    attachedSelections,
    setMessage,
    onAttach,
    agentKind,
    selectedModelId,
    selectedModel,
    personas,
    formRef,
    messageRef,
    setPreviewDismissed,
  ]);

  const handleRemoveSelection = useCallback(
    (index: number) => {
      if (chatId) useUIStore.getState().removeComposerSelection(chatId, index);
    },
    [chatId],
  );

  const handleTokenDeleteKeyDown = useTokenDeleteKeyDown(messageRef, textareaRef);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<Element>) => {
      const handledByMentions = handleMentionKeyDown(event);
      if (handledByMentions) return;

      const handledBySlashCommands = handleSlashCommandKeyDown(event);
      if (handledBySlashCommands) return;

      if (handleTokenDeleteKeyDown(event)) return;

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        submitOrStop();
      }
    },
    [handleMentionKeyDown, handleSlashCommandKeyDown, handleTokenDeleteKeyDown, submitOrStop],
  );

  const handleSendClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      submitOrStop();
    },
    [submitOrStop],
  );

  return {
    handleSubmit,
    submitOrStop,
    handleRemoveSelection,
    handleKeyDown,
    handleSendClick,
  };
}
