import { useRef, useState, useMemo, type ReactNode } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useUIStore, type ComposerSelection } from '@/store/uiStore';
import { useChatMachineId } from '@/store/machineOrigin';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import { useChatQuery, useRecentChatsQuery } from '@/hooks/queries/useChatQueries';
import { useChatContext } from '@/hooks/useChatContext';
import { useInputAttachments } from '@/hooks/useInputAttachments';
import { useInputEnhance } from '@/hooks/useInputEnhance';
import { useInputSuggestions } from '@/hooks/useInputSuggestions';
import { useInputSubmit } from '@/hooks/useInputSubmit';
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
import { getAgentKindForModelId, supportsUsageUpdates, type Chat } from '@/types/chat.types';
import { canAskSideQuestion, SIDE_QUESTION_SLASH_COMMAND } from '@/utils/sideQuestion';

// Stable fallback so chat-less composers (landing page) don't churn the selector.
const NO_SELECTIONS: ComposerSelection[] = [];
const NO_CHATS: Chat[] = [];

export function InputProvider({
  message,
  setMessage,
  onSubmit,
  onAttach,
  attachedFiles = null,
  isLoading,
  isStreaming = false,
  onStopStream,
  placeholder,
  selectedModelId,
  onModelChange,
  dropdownPosition = 'auto',
  showAttachedFilesPreview = true,
  contextUsage,
  showBranch = true,
  chatId,
  machineId,
  showLoadingSpinner = false,
  disabled = false,
  children,
}: InputProps & { children: ReactNode }) {
  const { fileStructure, builtinSlashCommands, personas } = useChatContext();
  // `/models/` is auth-protected; gate so the public landing composer doesn't 401.
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const chatMachineId = useChatMachineId(chatId);
  const modelMachineId = machineId ?? chatMachineId;
  const modelMap = useModelMap({ enabled: isAuthenticated, machineId: modelMachineId });
  const { data: recentChats } = useRecentChatsQuery(isAuthenticated);
  const selectedModel = modelMap.get(selectedModelId);
  const agentKind = selectedModel?.agent_kind ?? getAgentKindForModelId(selectedModelId);
  const { data: chat } = useChatQuery(chatId);
  const chatModel = modelMap.get(chat?.last_model_id ?? '');
  const sideQuestionAvailable = canAskSideQuestion(chat, chatModel);
  const slashCommands = useMemo(
    () =>
      sideQuestionAvailable
        ? {
            ...builtinSlashCommands,
            [agentKind]: [SIDE_QUESTION_SLASH_COMMAND, ...builtinSlashCommands[agentKind]],
          }
        : builtinSlashCommands,
    [sideQuestionAvailable, builtinSlashCommands, agentKind],
  );
  // Hide the context-usage indicator for agents whose ACP servers never emit
  // UsageUpdate notifications — without those events the value stays 0 and
  // the bar is misleading.
  const visibleContextUsage = supportsUsageUpdates(selectedModel, agentKind)
    ? contextUsage
    : undefined;
  const storedSelections = useUIStore((s) =>
    chatId ? s.composerSelectionsByChat[chatId] : undefined,
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

  const {
    previewUrls,
    showFileUpload,
    setShowFileUpload,
    showDrawingModal,
    editingImageIndex,
    handleFileSelect,
    handleRemoveFile,
    handleDrawClick,
    handleDrawingSave,
    closeDrawingModal,
    isDragging,
    dragHandlers,
    resetDragState,
    handlePaste,
  } = useInputAttachments({ machineId: modelMachineId, attachedFiles, onAttach });

  const { isEnhancing, handleEnhancePrompt } = useInputEnhance({
    setMessage,
    textareaRef,
    selectedModelId,
    messageRef,
    hasMessage,
  });

  const {
    slashCommandSuggestions,
    highlightedSlashCommandIndex,
    selectSlashCommand,
    handleSlashCommandKeyDown,
    filteredFiles,
    filteredChats,
    highlightedMentionIndex,
    selectMention,
    handleMentionKeyDown,
    isMentionActive,
  } = useInputSuggestions({
    message,
    cursorPosition,
    setMessage,
    setCursorPosition,
    messageRef,
    textareaRef,
    fileStructure,
    mentionChats: recentChats?.items ?? NO_CHATS,
    chatId,
    builtinSlashCommands: slashCommands,
    agentKind,
  });

  const { handleSubmit, submitOrStop, handleRemoveSelection, handleKeyDown, handleSendClick } =
    useInputSubmit({
      disabled,
      hasContent,
      onSubmit,
      setPreviewDismissed,
      isStreaming,
      onStopStream,
      isLoading,
      chatId,
      chat,
      chatModel,
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
    });

  const placeholders = useMemo(
    () =>
      isStreaming
        ? ['Type to queue message...', 'Queue…']
        : placeholder !== undefined
          ? [placeholder]
          : [
              'Message Agentrove... (@ to mention, / for commands)',
              'Message Agentrove…',
              'Message…',
            ],
    [isStreaming, placeholder],
  );

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
      showBranch,
      isDragging,
      placeholders,
      selectedModelId,
      dropdownPosition,
      attachedFiles,
      attachedSelections,
      previewUrls,
      editingImageIndex,
      contextUsage: visibleContextUsage,
      chatId,
      machineId: modelMachineId,
      isMentionActive,
      slashCommandSuggestions,
      highlightedSlashCommandIndex,
      filteredFiles,
      filteredChats,
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
      showBranch,
      isDragging,
      placeholders,
      selectedModelId,
      dropdownPosition,
      attachedFiles,
      attachedSelections,
      previewUrls,
      editingImageIndex,
      visibleContextUsage,
      chatId,
      modelMachineId,
      isMentionActive,
      slashCommandSuggestions,
      highlightedSlashCommandIndex,
      filteredFiles,
      filteredChats,
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
