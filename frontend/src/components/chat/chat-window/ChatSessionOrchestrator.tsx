import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useQueryClient } from '@tanstack/react-query';
import { ChatSessionProvider } from '@/contexts/ChatSessionContext';
import { ChatInputMessageProvider } from '@/contexts/ChatInputMessageContext';
import type { ChatSessionState, ChatSessionActions } from '@/contexts/ChatSessionContextDefinition';
import { useChatStore } from '@/store/chatStore';
import {
  useChatSettingsStore,
  DEFAULT_PERMISSION_MODE,
  DEFAULT_THINKING_MODE,
  DEFAULT_WORKTREE,
  DEFAULT_PLAN_MODE,
} from '@/store/chatSettingsStore';
import { useChatStreaming } from '@/hooks/useChatStreaming';
import { usePermissionRequest } from '@/hooks/usePermissionRequest';
import { useInitialPrompt } from '@/hooks/useInitialPrompt';
import { useContextUsageState } from '@/hooks/useContextUsageState';
import { useMessageInitialization } from '@/hooks/useMessageInitialization';
import { useModelSelection } from '@/hooks/queries/useModelQueries';
import type { Chat, Message } from '@/types/chat.types';
import type { useInfiniteMessagesQuery } from '@/hooks/queries/useChatQueries';

const EMPTY_FILES: File[] = [];

interface ChatSessionOrchestratorProps {
  chatId: string;
  currentChat: Chat | undefined;
  fetchedMessages: Message[];
  hasFetchedMessages: boolean;
  messagesQuery: ReturnType<typeof useInfiniteMessagesQuery>;
  useRouteInitialPrompt?: boolean;
  children: ReactNode;
}

export function ChatSessionOrchestrator({
  chatId,
  currentChat,
  fetchedMessages,
  hasFetchedMessages,
  messagesQuery,
  useRouteInitialPrompt = true,
  children,
}: ChatSessionOrchestratorProps) {
  const queryClient = useQueryClient();

  const { attachedFiles, clearAttachedFilesForChat } = useChatStore(
    useShallow((state) => ({
      attachedFiles: state.attachedFilesByChat[chatId] ?? EMPTY_FILES,
      clearAttachedFilesForChat: state.clearAttachedFilesForChat,
    })),
  );

  const permissionMode = useChatSettingsStore(
    (state) => state.permissionModeByChat[chatId] ?? DEFAULT_PERMISSION_MODE,
  );
  const thinkingMode = useChatSettingsStore(
    (state) => state.thinkingModeByChat[chatId] ?? DEFAULT_THINKING_MODE,
  );
  const worktree = useChatSettingsStore(
    (state) => state.worktreeByChat[chatId] ?? DEFAULT_WORKTREE,
  );
  const planMode = useChatSettingsStore(
    (state) => state.planModeByChat[chatId] ?? DEFAULT_PLAN_MODE,
  );
  const lastAssistantModelId = useMemo((): string | null | undefined => {
    if (messagesQuery.isLoading) return null;
    for (let i = fetchedMessages.length - 1; i >= 0; i--) {
      if (fetchedMessages[i].role === 'assistant' && fetchedMessages[i].model_id) {
        return fetchedMessages[i].model_id;
      }
    }
    return undefined;
  }, [fetchedMessages, messagesQuery.isLoading]);

  const { selectedModelId, selectedModel, selectModel } = useModelSelection({
    chatId,
    initialModelId: lastAssistantModelId,
  });

  const {
    initialPrompt,
    setInitialPrompt,
    initialPromptSent,
    setInitialPromptSent,
    initialPromptFromRoute,
  } = useInitialPrompt();
  const effectiveInitialPrompt = useRouteInitialPrompt ? initialPrompt : null;
  const effectiveInitialPromptFromRoute = useRouteInitialPrompt ? initialPromptFromRoute : null;

  const { contextUsage, updateContextUsage } = useContextUsageState(
    chatId,
    currentChat,
    selectedModel?.context_window,
  );

  const {
    pendingRequest,
    isLoading: isPermissionLoading,
    error: permissionError,
    handlePermissionRequest,
    handleApprove,
    handleReject,
  } = usePermissionRequest(chatId);

  const streamingState = useChatStreaming({
    chatId,
    currentChat,
    fetchedMessages,
    hasFetchedMessages,
    isInitialLoading: messagesQuery.isLoading,
    queryClient,
    onContextUsageUpdate: updateContextUsage,
    selectedModelId,
    permissionMode,
    thinkingMode,
    worktree,
    planMode,
    onPermissionRequest: handlePermissionRequest,
  });

  const { messages, sendMessage, isLoading, isStreaming, wasAborted, setMessages } = streamingState;

  useMessageInitialization({
    fetchedMessages,
    chatId,
    selectedModelId,
    initialPromptFromRoute: effectiveInitialPromptFromRoute,
    initialPromptSent,
    wasAborted,
    attachedFiles,
    isLoading,
    isStreaming,
    setMessages,
    setInitialPrompt,
  });

  const initialPromptActionsRef = useRef({
    sendMessage,
    chatId,
    attachedFiles,
    setInitialPromptSent,
    clearAttachedFilesForChat,
  });
  initialPromptActionsRef.current = {
    sendMessage,
    chatId,
    attachedFiles,
    setInitialPromptSent,
    clearAttachedFilesForChat,
  };

  useEffect(() => {
    if (
      effectiveInitialPrompt &&
      messages.length === 1 &&
      !isLoading &&
      !isStreaming &&
      !initialPromptSent &&
      !messagesQuery.isLoading &&
      !hasFetchedMessages
    ) {
      const {
        sendMessage: send,
        chatId: cid,
        attachedFiles: files,
        setInitialPromptSent: setSent,
        clearAttachedFilesForChat: clearFiles,
      } = initialPromptActionsRef.current;
      const userMessage = messages[0];
      send(effectiveInitialPrompt, cid, userMessage, files);
      setSent(true);
      clearFiles(cid);
    }
  }, [
    effectiveInitialPrompt,
    messages,
    isLoading,
    isStreaming,
    initialPromptSent,
    messagesQuery.isLoading,
    hasFetchedMessages,
  ]);

  const prevChatIdForPromptRef = useRef(chatId);
  if (prevChatIdForPromptRef.current !== chatId) {
    prevChatIdForPromptRef.current = chatId;
    setInitialPromptSent(false);
  }

  const chatSessionState = useMemo<ChatSessionState>(
    () => ({
      messages,
      isLoading,
      isStreaming,
      isInitialLoading: messagesQuery.isLoading || (hasFetchedMessages && messages.length === 0),
      copiedMessageId: streamingState.copiedMessageId,
      pendingUserMessageId: streamingState.pendingUserMessageId,
      attachedFiles: streamingState.inputFiles,
      selectedModelId,
      contextUsage,
      hasNextPage: messagesQuery.hasNextPage,
      isFetchingNextPage: messagesQuery.isFetchingNextPage,
      pendingPermissionRequest: pendingRequest,
      isPermissionLoading,
      permissionError,
    }),
    [
      messages,
      streamingState.copiedMessageId,
      streamingState.pendingUserMessageId,
      streamingState.inputFiles,
      isLoading,
      isStreaming,
      messagesQuery.isLoading,
      hasFetchedMessages,
      messagesQuery.hasNextPage,
      messagesQuery.isFetchingNextPage,
      selectedModelId,
      contextUsage,
      pendingRequest,
      isPermissionLoading,
      permissionError,
    ],
  );

  const chatSessionActions = useMemo<ChatSessionActions>(
    () => ({
      onSubmit: streamingState.handleMessageSend,
      onStopStream: streamingState.handleStop,
      onCopy: streamingState.handleCopy,
      onAttach: streamingState.setInputFiles,
      onModelChange: selectModel,
      fetchNextPage: messagesQuery.fetchNextPage,
      onPermissionApprove: handleApprove,
      onPermissionReject: handleReject,
    }),
    [
      streamingState.handleMessageSend,
      streamingState.handleStop,
      streamingState.handleCopy,
      streamingState.setInputFiles,
      selectModel,
      messagesQuery.fetchNextPage,
      handleApprove,
      handleReject,
    ],
  );

  return (
    <ChatSessionProvider state={chatSessionState} actions={chatSessionActions}>
      <ChatInputMessageProvider
        inputMessage={streamingState.inputMessage}
        setInputMessage={streamingState.setInputMessage}
      >
        {children}
      </ChatInputMessageProvider>
    </ChatSessionProvider>
  );
}
