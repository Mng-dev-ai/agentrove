import { useCallback, useEffect, useRef, useState } from 'react';
import { useMountEffect } from '@/hooks/useMountEffect';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { logger } from '@/utils/logger';
import { QueryClient } from '@tanstack/react-query';
import { useStreamStore } from '@/store/streamStore';
import type { Chat, ContextUsage, Message, PermissionRequest } from '@/types/chat.types';
import type { PermissionMode } from '@/store/chatSettingsStore';
import type { StreamState } from '@/types/stream.types';
import { cleanupExpiredPdfBlobs, storePdfBlobUrl } from '@/hooks/usePdfBlobCache';
import { chatStorage } from '@/utils/storage';
import { useMessageActions } from '@/hooks/useMessageActions';
import { useInputState } from '@/hooks/useInputState';
import { useClipboard } from '@/hooks/useClipboard';
import { useStreamCallbacks } from '@/hooks/useStreamCallbacks';
import { useStreamReconnect } from '@/hooks/useStreamReconnect';

interface UseChatStreamingParams {
  chatId: string | undefined;
  currentChat: Chat | undefined;
  fetchedMessages: Message[];
  hasFetchedMessages: boolean;
  isInitialLoading: boolean;
  queryClient: QueryClient;
  refetchFilesMetadata: () => Promise<unknown>;
  onContextUsageUpdate?: (data: ContextUsage, chatId?: string) => void;
  selectedModelId: string | null | undefined;
  permissionMode: PermissionMode;
  thinkingMode: string | null | undefined;
  worktree: boolean;
  planMode: boolean;
  onPermissionRequest?: (request: PermissionRequest) => void;
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

// Top-level hook that wires together the streaming pipeline for a single chat view.
// Composes useStreamCallbacks (envelope processing), useStreamReconnect (resume on
// navigation), useMessageActions (send/stop), and useInputState (draft persistence).
// Returns the full set of state and handlers consumed by the chat UI components.
export function useChatStreaming({
  chatId,
  currentChat,
  fetchedMessages,
  hasFetchedMessages,
  isInitialLoading,
  queryClient,
  refetchFilesMetadata,
  onContextUsageUpdate,
  selectedModelId,
  permissionMode,
  thinkingMode,
  worktree,
  planMode,
  onPermissionRequest,
}: UseChatStreamingParams): UseChatStreamingResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamState, setStreamState] = useState<StreamState>('idle');
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [wasAborted, setWasAborted] = useState(false);
  const [pendingUserMessageId, setPendingUserMessageIdState] = useState<string | null>(null);
  const pendingStopRef = useRef<Set<string>>(new Set());
  const prevChatIdRef = useRef<string | undefined>(chatId);
  const currentMessageIdRef = useRef<string | null>(null);

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
    updateMessageInCache,
    addMessageToCache,
    setPendingUserMessageId,
  } = useStreamCallbacks({
    messages,
    chatId,
    currentChat,
    queryClient,
    refetchFilesMetadata,
    onContextUsageUpdate,
    onPermissionRequest,
    setMessages,
    setStreamState,
    setCurrentMessageId,
    pendingStopRef,
    onPendingUserMessageIdChange: setPendingUserMessageIdState,
  });

  // Keep the global stream store's callbacks in sync with the latest hook closures.
  // Streams outlive individual renders, so without this the store would dispatch
  // events through stale callbacks that close over outdated chatId/messages.
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

  // Subscribes to the stream store and mirrors active-stream presence into
  // local React state (streamState, currentMessageId). This is the bridge
  // between the global EventSource lifecycle and the per-chat UI indicators.
  useEffect(() => {
    if (!chatId) return;

    const reconcileStreamState = () => {
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
    };

    reconcileStreamState();

    const unsubscribe = useStreamStore.subscribe(reconcileStreamState);
    return () => unsubscribe();
  }, [chatId]);

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
    planMode,
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
    updateMessageInCache,
    replayStream,
  });

  const markStreamIdleAfterAbort = useCallback(() => {
    setStreamState('idle');
    setCurrentMessageId(null);
    setWasAborted(true);
    setPendingUserMessageId(null);
  }, [setPendingUserMessageId]);

  // Sends stop requests for one or all active streams in the current chat.
  // Immediately marks the UI as idle (optimistic) and tracks pending stops
  // so incoming envelopes for the stopping stream are ignored.
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
      }
    },
    [chatId, markStreamIdleAfterAbort, stopStream],
  );

  useEffect(() => {
    currentMessageIdRef.current = currentMessageId;
  }, [currentMessageId]);

  const handleStop = useCallback(() => {
    if (streamState === 'loading') {
      cancelPendingStart();
      markStreamIdleAfterAbort();
      clearInput();
      return;
    }
    void stopActiveStreams(currentMessageIdRef.current || undefined);
    clearInput();
  }, [cancelPendingStart, clearInput, markStreamIdleAfterAbort, stopActiveStreams, streamState]);

  useMountEffect(() => {
    cleanupExpiredPdfBlobs();
    chatStorage.pruneStaleEntries();
    const interval = setInterval(cleanupExpiredPdfBlobs, 1000 * 60 * 30);
    return () => clearInterval(interval);
  });

  const handleMessageSend = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const result = await handleMessageSendAction(inputMessageRef.current, inputFiles);
      if (result?.success) {
        clearInput();
      }
    },
    [handleMessageSendAction, inputFiles, clearInput],
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
