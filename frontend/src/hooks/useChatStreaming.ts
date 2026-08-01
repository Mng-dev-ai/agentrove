import { useCallback, useEffect, useRef, useState } from 'react';
import { useMountEffect } from '@/hooks/useMountEffect';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { logger } from '@/utils/logger';
import { QueryClient } from '@tanstack/react-query';
import { useStreamStore } from '@/store/streamStore';
import type {
  Chat,
  ContextUsage,
  ElicitationRequest,
  Message,
  PermissionRequest,
} from '@/types/chat.types';
import type { PermissionMode } from '@/store/chatSettingsStore';
import type { StreamState } from '@/types/stream.types';
import { cleanupExpiredPdfBlobs, storePdfBlobUrl } from '@/hooks/usePdfBlobCache';
import { chatStorage } from '@/utils/storage';
import { useMessageActions } from '@/hooks/useMessageActions';
import { useInputState } from '@/hooks/useInputState';
import { useClipboard } from '@/hooks/useClipboard';
import { useStreamCallbacks } from '@/hooks/useStreamCallbacks';
import { useStreamReconnect } from '@/hooks/useStreamReconnect';
import { chatService } from '@/services/chatService';
import { useUIStore } from '@/store/uiStore';
import { formatComposerSelections } from '@/utils/composerSelections';

interface UseChatStreamingParams {
  chatId: string | undefined;
  currentChat: Chat | undefined;
  fetchedMessages: Message[];
  hasFetchedMessages: boolean;
  isInitialLoading: boolean;
  queryClient: QueryClient;
  onContextUsageUpdate?: (data: ContextUsage, chatId?: string) => void;
  selectedModelId: string | null | undefined;
  permissionMode: PermissionMode;
  thinkingMode: string | null | undefined;
  worktree: boolean;
  baseBranch: string | undefined;
  fastMode: boolean;
  onPermissionRequest?: (request: PermissionRequest) => void;
  onElicitationRequest?: (request: ElicitationRequest) => void;
  onElicitationDismissed?: (requestId: string) => void;
}

interface UseChatStreamingResult {
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  pendingUserMessageId: string | null;
  inputMessage: string;
  setInputMessage: Dispatch<SetStateAction<string>>;
  inputFiles: File[];
  setInputFiles: Dispatch<SetStateAction<File[]>>;
  copiedMessageId: string | null;
  handleCopy: (content: string, id: string) => Promise<void>;
  handleMessageSend: (event: FormEvent) => Promise<void>;
  handleStop: () => void;
  sendMessage: (
    prompt: string,
    chatIdOverride?: string,
    userMessage?: Message,
    filesToSend?: File[],
    fileCountBeforeOverride?: number,
  ) => Promise<void>;
  isLoading: boolean;
  isStreaming: boolean;
  wasAborted: boolean;
  setWasAborted: Dispatch<SetStateAction<boolean>>;
  currentMessageId: string | null;
  streamState: StreamState;
}

// Per-chat streaming pipeline: useStreamCallbacks, useStreamReconnect, useMessageActions, useInputState.
export function useChatStreaming({
  chatId,
  currentChat,
  fetchedMessages,
  hasFetchedMessages,
  isInitialLoading,
  queryClient,
  onContextUsageUpdate,
  selectedModelId,
  permissionMode,
  thinkingMode,
  worktree,
  baseBranch,
  fastMode,
  onPermissionRequest,
  onElicitationRequest,
  onElicitationDismissed,
}: UseChatStreamingParams): UseChatStreamingResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamState, setStreamState] = useState<StreamState>('idle');
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [wasAborted, setWasAborted] = useState(false);
  const [pendingUserMessageId, setPendingUserMessageIdState] = useState<string | null>(null);
  const pendingStopRef = useRef<Set<string>>(new Set());
  const prevChatIdRef = useRef<string | undefined>(chatId);
  const currentMessageIdRef = useRef<string | null>(null);
  currentMessageIdRef.current = currentMessageId;

  const isLoading = streamState === 'loading';
  const isStreaming = streamState === 'streaming';

  const { inputMessage, setInputMessage, inputFiles, setInputFiles, clearInput } = useInputState({
    chatId,
  });
  const inputMessageRef = useRef(inputMessage);
  inputMessageRef.current = inputMessage;

  const setInputMessageWithRef = useCallback(
    (value: SetStateAction<string>) => {
      const next = typeof value === 'function' ? value(inputMessageRef.current) : value;
      inputMessageRef.current = next;
      setInputMessage(next);
    },
    [setInputMessage],
  );
  const { copiedMessageId, handleCopy } = useClipboard({ chatId });

  const {
    onEnvelope,
    onComplete,
    onError,
    onQueueProcess,
    startStream,
    replayStream,
    stopStream,
    addMessageToCache,
    setPendingUserMessageId,
  } = useStreamCallbacks({
    messages,
    chatId,
    currentChat,
    queryClient,
    onContextUsageUpdate,
    onPermissionRequest,
    onElicitationRequest,
    onElicitationDismissed,
    setMessages,
    setStreamState,
    setCurrentMessageId,
    pendingStopRef,
    onPendingUserMessageIdChange: setPendingUserMessageIdState,
  });

  // Streams outlive renders — keep store callbacks pointed at the latest closures.
  useEffect(() => {
    if (!chatId) return;

    const syncCallbacksToStore = () => {
      const existingStream = useStreamStore.getState().getStreamByChat(chatId);
      if (existingStream) {
        useStreamStore.getState().updateStreamCallbacks(chatId, existingStream.messageId, {
          onEnvelope,
          onComplete,
          onError,
          onQueueProcess,
        });
      }
    };

    syncCallbacksToStore();

    let prevStreams = useStreamStore.getState().activeStreams;
    const unsubscribe = useStreamStore.subscribe((state) => {
      if (state.activeStreams !== prevStreams) {
        prevStreams = state.activeStreams;
        syncCallbacksToStore();
      }
    });
    return () => unsubscribe();
  }, [chatId, onEnvelope, onComplete, onError, onQueueProcess]);

  if (prevChatIdRef.current !== chatId) {
    prevChatIdRef.current = chatId;
    setStreamState('idle');
    setCurrentMessageId(null);
    setWasAborted(false);
    setPendingUserMessageIdState(null);
    setMessages([]);
  }

  const reconcileStreamState = useCallback(() => {
    if (!chatId) return;

    const activeStreamForChat = useStreamStore.getState().getStreamByChat(chatId);

    if (activeStreamForChat) {
      const isPendingStop = pendingStopRef.current.has(activeStreamForChat.messageId);

      if (!isPendingStop) {
        setStreamState('streaming');
        setCurrentMessageId(activeStreamForChat.messageId);
        setWasAborted(false);
      }
    } else {
      setStreamState((prev) => {
        if (prev === 'streaming') {
          setCurrentMessageId(null);
          pendingStopRef.current.clear();
          return 'idle';
        }
        return prev;
      });
    }
  }, [chatId]);

  useEffect(() => {
    if (!chatId) return;

    reconcileStreamState();

    const unsubscribe = useStreamStore.subscribe(reconcileStreamState);
    return () => unsubscribe();
  }, [chatId, reconcileStreamState]);

  const {
    sendMessage,
    handleMessageSend: handleMessageSendAction,
    cancelPendingStart,
  } = useMessageActions({
    chatId,
    selectedModelId,
    permissionMode,
    thinkingMode,
    worktree,
    baseBranch,
    fastMode,
    setStreamState,
    setCurrentMessageId,
    setWasAborted,
    setMessages,
    addMessageToCache,
    startStream,
    storeBlobUrl: storePdfBlobUrl,
    setPendingUserMessageId,
    isLoading,
    isStreaming,
  });

  useStreamReconnect({
    chatId,
    fetchedMessages,
    hasFetchedMessages,
    isInitialLoading,
    streamState,
    currentMessageId,
    wasAborted,
    selectedModelId,
    setStreamState,
    setCurrentMessageId,
    setMessages,
    addMessageToCache,
    replayStream,
  });

  const markStreamIdleAfterAbort = useCallback(() => {
    setStreamState('idle');
    setCurrentMessageId(null);
    setWasAborted(true);
    setPendingUserMessageId(null);
  }, [setPendingUserMessageId]);

  // Track pending stops so store presence doesn't flip UI back to streaming mid-flight.
  const stopActiveStreams = useCallback(
    async (messageId?: string) => {
      const pendingIds = new Set<string>();
      const stopPromises: Promise<void>[] = [];
      if (messageId) {
        pendingIds.add(messageId);
        stopPromises.push(stopStream(messageId));
      } else if (chatId) {
        useStreamStore.getState().activeStreams.forEach((stream) => {
          if (stream.chatId === chatId && stream.isActive) {
            pendingIds.add(stream.messageId);
            stopPromises.push(stopStream(stream.messageId));
          }
        });
      }
      pendingStopRef.current = pendingIds;
      markStreamIdleAfterAbort();

      const results = await Promise.allSettled(stopPromises);
      let anyFailed = false;
      for (const result of results) {
        if (result.status === 'rejected') {
          anyFailed = true;
          logger.error('Stream stop request failed', 'useChatStreaming', result.reason);
        }
      }
      if (anyFailed) {
        pendingStopRef.current.clear();
        reconcileStreamState();
      }
    },
    [chatId, markStreamIdleAfterAbort, reconcileStreamState, stopStream],
  );

  const handleStop = useCallback(() => {
    if (streamState === 'loading') {
      cancelPendingStart();
      markStreamIdleAfterAbort();
      if (chatId) {
        void chatService.stopStream(chatId).catch((error) => {
          logger.error('Pending stream stop request failed', 'useChatStreaming', error);
          setWasAborted(false);
        });
      }
      clearInput();
      return;
    }
    void stopActiveStreams(currentMessageIdRef.current || undefined);
    clearInput();
  }, [
    cancelPendingStart,
    chatId,
    clearInput,
    markStreamIdleAfterAbort,
    stopActiveStreams,
    streamState,
  ]);

  useMountEffect(() => {
    cleanupExpiredPdfBlobs();
    chatStorage.pruneStaleEntries();
    const interval = setInterval(cleanupExpiredPdfBlobs, 1000 * 60 * 30);
    return () => clearInterval(interval);
  });

  const handleMessageSend = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      // Selection chips live in the UI store; serialize them into the prompt
      // only now so the visible input text stays clean while they're attached.
      const selections = chatId
        ? (useUIStore.getState().composerSelectionsByChat[chatId] ?? [])
        : [];
      const draftMessage = inputMessageRef.current;
      const draftFiles = inputFiles;
      // Clear optimistically — the send awaits a server round-trip (startStream),
      // and the draft would otherwise linger in the input bar until it resolves.
      clearInput();
      if (chatId && selections.length > 0) {
        useUIStore.getState().clearComposerSelections(chatId);
      }
      const result = await handleMessageSendAction(
        formatComposerSelections(selections, draftMessage),
        draftFiles,
      );
      if (!result?.success) {
        setInputMessageWithRef(draftMessage);
        setInputFiles(draftFiles);
        if (chatId) {
          selections.forEach((sel) => useUIStore.getState().addComposerSelection(chatId, sel));
        }
      }
    },
    [
      chatId,
      handleMessageSendAction,
      inputFiles,
      clearInput,
      setInputMessageWithRef,
      setInputFiles,
    ],
  );

  return {
    messages,
    setMessages,
    pendingUserMessageId,
    inputMessage,
    setInputMessage: setInputMessageWithRef,
    inputFiles,
    setInputFiles,
    copiedMessageId,
    handleCopy,
    handleMessageSend,
    handleStop,
    sendMessage,
    isLoading,
    isStreaming,
    wasAborted,
    setWasAborted,
    currentMessageId,
    streamState,
  };
}
