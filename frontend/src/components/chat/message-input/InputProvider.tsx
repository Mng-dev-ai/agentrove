import { useRef, useState, useCallback, useMemo, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import { useFileHandling } from '@/hooks/useFileHandling';
import { useInputFileOperations } from '@/hooks/useInputFileOperations';
import { useSlashCommandSuggestions } from '@/hooks/useSlashCommandSuggestions';
import { useEnhancePromptMutation } from '@/hooks/queries/useChatQueries';
import { useMentionSuggestions } from '@/hooks/useMentionSuggestions';
import { useMessageQueueStore } from '@/store/messageQueueStore';
import { useAuthStore } from '@/store/authStore';
import { useUIStore, type EditorCodeSelection } from '@/store/uiStore';
import { formatEditorSelections } from '@/lib/editorChatActions';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import { coercePermissionModeForAgent } from '@/components/chat/permission-mode-selector/permissionModes';
import { coerceThinkingModeForAgent } from '@/components/chat/thinking-mode-selector/thinkingModes';
import {
  useChatSettingsStore,
  DEFAULT_PERMISSION_MODE,
  DEFAULT_THINKING_MODE,
  DEFAULT_WORKTREE,
  DEFAULT_PLAN_MODE,
  DEFAULT_PERSONA,
} from '@/store/chatSettingsStore';
import { resolvePersona } from '@/utils/settings';
import { useChatContext } from '@/hooks/useChatContext';
import { getHighlightTokenRanges, insertToken } from '@/utils/mentionParser';
import {
  InputContext,
  InputStateContext,
  InputActionsContext,
  type InputState,
  type InputActions,
  type InputMeta,
  type InputContextValue,
} from './InputContext';
import type { InputProps } from './Input';
import type { MentionItem, SlashCommand } from '@/types/ui.types';
import { getAgentKindForModelId, type AgentKind } from '@/types/chat.types';

// Agents whose ACP servers don't emit UsageUpdate notifications — the context
// window indicator stays at 0 for these, so we hide it entirely.
const AGENTS_WITHOUT_USAGE_UPDATE: ReadonlySet<AgentKind> = new Set([
  'copilot',
  'cursor',
  'opencode',
]);

// Stable fallback so chat-less composers (landing page) don't churn the selector.
const NO_SELECTIONS: EditorCodeSelection[] = [];

export function InputProvider({
  message,
  setMessage,
  onSubmit,
  onAttach,
  attachedFiles = null,
  isLoading,
  isStreaming = false,
  onStopStream,
  placeholder = 'Message Agentrove... (@ to mention, / for commands)',
  selectedModelId,
  onModelChange,
  dropdownPosition = 'top',
  showAttachedFilesPreview = true,
  contextUsage,
  showTip = true,
  compact = true,
  chatId,
  showLoadingSpinner = false,
  disabled = false,
  children,
}: InputProps & { children: ReactNode }) {
  const { fileStructure, customSkills, builtinSlashCommands, personas } = useChatContext();
  // `/models/` is auth-protected; gate so the public landing composer doesn't 401.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const modelMap = useModelMap(isAuthenticated);
  const agentKind =
    modelMap.get(selectedModelId)?.agent_kind ?? getAgentKindForModelId(selectedModelId);
  // Hide the context-usage indicator for agents whose ACP servers never emit
  // UsageUpdate notifications — without those events the value stays 0 and
  // the bar is misleading.
  const visibleContextUsage = AGENTS_WITHOUT_USAGE_UPDATE.has(agentKind) ? undefined : contextUsage;
  const storedSelections = useUIStore((s) =>
    chatId ? s.editorSelectionsByChat[chatId] : undefined,
  );
  const attachedSelections = storedSelections ?? NO_SELECTIONS;

  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [previewDismissed, setPreviewDismissed] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const messageRef = useRef(message);
  messageRef.current = message;

  const hasMessage = message.trim().length > 0;
  // A selection chip is prompt content on its own — it can be sent without text.
  const hasContent = hasMessage || attachedSelections.length > 0;
  const hasAttachments = (attachedFiles?.length ?? 0) > 0;

  const prevHasAttachments = useRef(hasAttachments);
  if (prevHasAttachments.current !== hasAttachments) {
    prevHasAttachments.current = hasAttachments;
    setPreviewDismissed(false);
  }

  const showPreview = showAttachedFilesPreview && hasAttachments && !previewDismissed;

  const { previewUrls } = useFileHandling({
    initialFiles: attachedFiles,
  });

  const {
    showFileUpload,
    setShowFileUpload,
    showDrawingModal,
    editingImageIndex,
    handleFileSelect,
    handleRemoveFile,
    handleDrawClick,
    handleDrawingSave,
    handleDroppedFiles,
    closeDrawingModal,
  } = useInputFileOperations({
    attachedFiles,
    onAttach,
  });

  const { isDragging, dragHandlers, resetDragState } = useDragAndDrop({
    onFilesDrop: handleDroppedFiles,
  });

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      // Pasted screenshots/files arrive as clipboard files — route them through the
      // same validated attach path as drag-and-drop instead of losing them.
      const files = Array.from(event.clipboardData.files);
      if (!onAttach || files.length === 0) return;
      event.preventDefault();
      handleDroppedFiles(files);
    },
    [onAttach, handleDroppedFiles],
  );

  const focusTextarea = useCallback((text: string) => {
    const textarea = textareaRef.current;
    if (textarea) {
      setTimeout(() => {
        textarea.focus();
        const length = text.length;
        textarea.setSelectionRange(length, length);
      }, 0);
    }
  }, []);

  const enhancePromptMutation = useEnhancePromptMutation({
    onSuccess: (enhancedPrompt) => {
      setMessage(enhancedPrompt);
      focusTextarea(enhancedPrompt);
    },
  });

  const isEnhancing = enhancePromptMutation.isPending;

  const insertTokenAt = useCallback(
    (tokenText: string, startPos: number, endPos: number) => {
      const { text, cursor } = insertToken(messageRef.current, tokenText, startPos, endPos);

      setMessage(text);

      setTimeout(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(cursor, cursor);
          setCursorPosition(cursor);
        }
      }, 0);
    },
    [setMessage],
  );

  const handleSlashCommandSelect = useCallback(
    (command: SlashCommand, startPos: number, endPos: number) => {
      insertTokenAt(command.value, startPos, endPos);
    },
    [insertTokenAt],
  );

  const {
    filteredCommands: slashCommandSuggestions,
    highlightedIndex: highlightedSlashCommandIndex,
    selectCommand: selectSlashCommand,
    handleKeyDown: handleSlashCommandKeyDown,
  } = useSlashCommandSuggestions({
    message,
    cursorPosition,
    onSelect: handleSlashCommandSelect,
    customSkills,
    builtinSlashCommands,
    agentKind,
  });

  const handleMentionSelect = useCallback(
    (item: MentionItem, mentionStartPos: number, mentionEndPos: number) => {
      insertTokenAt(`@${item.path}`, mentionStartPos, mentionEndPos);
    },
    [insertTokenAt],
  );

  const {
    filteredFiles,
    highlightedIndex: highlightedMentionIndex,
    selectItem: selectMention,
    handleKeyDown: handleMentionKeyDown,
    isActive: isMentionActive,
  } = useMentionSuggestions({
    message,
    cursorPosition: cursorPosition,
    fileStructure,
    onSelect: handleMentionSelect,
  });

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (disabled) return;
      if (!hasContent) return;

      setPreviewDismissed(true);
      onSubmit(event);
    },
    [disabled, hasContent, onSubmit],
  );

  const submitOrStop = useCallback(() => {
    if (isStreaming && !hasContent) {
      onStopStream?.();
      return;
    }

    if (disabled) return;

    if (isStreaming && hasContent && chatId) {
      // Mirror the send path's model guard — queueMessage is fire-and-forget
      // and the draft is cleared below, so a rejected queue call loses the message.
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
        selectedModelId,
      );
      const worktree = settings.worktreeByChat[chatId] ?? DEFAULT_WORKTREE;
      const planMode =
        agentKind === 'codex' && (settings.planModeByChat[chatId] ?? DEFAULT_PLAN_MODE);
      const storedPersona = settings.personaByChat[chatId] ?? DEFAULT_PERSONA;
      const validPersona = resolvePersona(storedPersona, personas);
      // Queued messages are stored as plain text, so serialize chips here.
      const fullMessage = formatEditorSelections(attachedSelections, messageRef.current.trim());
      void useMessageQueueStore
        .getState()
        .queueMessage(
          chatId,
          fullMessage,
          selectedModelId,
          permissionMode,
          thinkingMode,
          worktree,
          planMode,
          validPersona,
          attachedFiles ?? undefined,
        );
      setMessage('');
      onAttach?.([]);
      if (attachedSelections.length > 0) useUIStore.getState().clearEditorSelections(chatId);
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
    personas,
  ]);

  const handleRemoveSelection = useCallback(
    (index: number) => {
      if (chatId) useUIStore.getState().removeEditorSelection(chatId, index);
    },
    [chatId],
  );

  const handleTokenDeleteKeyDown = useCallback((event: React.KeyboardEvent<Element>) => {
    // First Backspace/Delete at a pill's boundary selects token + separator space;
    // the next keystroke deletes it natively (undo intact). Backspace triggers only
    // after the separator — at the bare token end the user is still composing.
    if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
    const textarea = textareaRef.current;
    if (!textarea) return false;
    const { selectionStart, selectionEnd } = textarea;
    if (selectionStart !== selectionEnd) return false;
    const message = messageRef.current;
    for (const [start, end] of getHighlightTokenRanges(message)) {
      const hasSeparator = message[end] === ' ';
      const atEdge =
        event.key === 'Backspace'
          ? hasSeparator && selectionStart === end + 1
          : selectionStart === start;
      if (atEdge) {
        event.preventDefault();
        textarea.setSelectionRange(start, hasSeparator ? end + 1 : end);
        return true;
      }
    }
    return false;
  }, []);

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

  const handleEnhancePrompt = useCallback(() => {
    if (!hasMessage || isEnhancing) return;
    enhancePromptMutation.mutate({ prompt: messageRef.current.trim(), modelId: selectedModelId });
  }, [hasMessage, isEnhancing, selectedModelId, enhancePromptMutation]);

  const dynamicPlaceholder = isStreaming ? 'Type to queue message...' : placeholder;

  const stateValue: InputState = useMemo(
    () => ({
      message,
      cursorPosition,
      isLoading,
      isDisabled: disabled,
      isStreaming,
      isEnhancing,
      hasMessage,
      hasContent,
      hasAttachments,
      showPreview,
      showFileUpload,
      showDrawingModal,
      showLoadingSpinner,
      showTip,
      isDragging,
      compact,
      placeholder: dynamicPlaceholder,
      selectedModelId,
      dropdownPosition,
      attachedFiles,
      attachedSelections,
      previewUrls,
      editingImageIndex,
      contextUsage: visibleContextUsage,
      chatId,
      isMentionActive,
      slashCommandSuggestions,
      highlightedSlashCommandIndex,
      filteredFiles,
      highlightedMentionIndex,
    }),
    [
      message,
      cursorPosition,
      isLoading,
      disabled,
      isStreaming,
      isEnhancing,
      hasMessage,
      hasContent,
      hasAttachments,
      showPreview,
      showFileUpload,
      showDrawingModal,
      showLoadingSpinner,
      showTip,
      isDragging,
      compact,
      dynamicPlaceholder,
      selectedModelId,
      dropdownPosition,
      attachedFiles,
      attachedSelections,
      previewUrls,
      editingImageIndex,
      visibleContextUsage,
      chatId,
      isMentionActive,
      slashCommandSuggestions,
      highlightedSlashCommandIndex,
      filteredFiles,
      highlightedMentionIndex,
    ],
  );

  const actionsValue: InputActions = useMemo(
    () => ({
      setMessage,
      setCursorPosition,
      setShowFileUpload,
      onModelChange,
      handleSubmit,
      submitOrStop,
      handleKeyDown,
      handleSendClick,
      handleEnhancePrompt,
      handleFileSelect,
      handleRemoveFile,
      handleRemoveSelection,
      handleDrawClick,
      handleDrawingSave,
      handlePaste,
      closeDrawingModal,
      resetDragState,
      selectSlashCommand,
      selectMention,
    }),
    [
      setMessage,
      setCursorPosition,
      setShowFileUpload,
      onModelChange,
      handleSubmit,
      submitOrStop,
      handleKeyDown,
      handleSendClick,
      handleEnhancePrompt,
      handleFileSelect,
      handleRemoveFile,
      handleRemoveSelection,
      handleDrawClick,
      handleDrawingSave,
      handlePaste,
      closeDrawingModal,
      resetDragState,
      selectSlashCommand,
      selectMention,
    ],
  );

  const metaValue: InputMeta = useMemo(
    () => ({
      formRef,
      textareaRef,
      dragHandlers,
    }),
    [dragHandlers],
  );

  const value: InputContextValue = useMemo(
    () => ({ state: stateValue, actions: actionsValue, meta: metaValue }),
    [stateValue, actionsValue, metaValue],
  );

  return (
    <InputContext.Provider value={value}>
      <InputStateContext.Provider value={stateValue}>
        <InputActionsContext.Provider value={actionsValue}>{children}</InputActionsContext.Provider>
      </InputStateContext.Provider>
    </InputContext.Provider>
  );
}
