import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { QueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { extractAssistantText, type StreamContentBuffer } from '@/utils/stream';
import { notifyStreamComplete } from '@/utils/notifications';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { markChatViewed } from '@/hooks/queries/useChatQueries';
import { invalidateGitState } from '@/hooks/queries/useSandboxQueries';
import { useBackgroundNotify } from '@/hooks/useBackgroundNotify';
import type {
  AssistantStreamEvent,
  Chat,
  ContextUsage,
  ElicitationRequest,
  ElicitationSchema,
  Message,
  PermissionRequest,
} from '@/types/chat.types';
import type { ToolEventPayload } from '@/types/tools.types';
import type { QueueProcessingData, StreamEnvelope, StreamState } from '@/types/stream.types';
import { useMessageCache } from '@/hooks/useMessageCache';
import { streamService } from '@/services/streamService';
import type { StreamOptions } from '@/services/streamService';
import { useChatSettingsStore, type PermissionMode } from '@/store/chatSettingsStore';
import type { PaginatedMessages } from '@/types/api.types';
import {
  findMessageInCache,
  patchChatWorktreeCwd,
  updateMessageInCacheForChat,
} from '@/hooks/stream/cachePatch';
import {
  buildContentFlushUpdate,
  buildFailedMessageUpdate,
  createEmptyRenderSnapshot,
  getStreamErrorMessage,
} from '@/hooks/stream/messageUpdates';
import { envelopeToRenderEvent, extractPayloadData } from '@/hooks/stream/envelopeTranslation';
import {
  advanceStreamSession,
  clearStreamSession,
  createStreamSession,
  findStreamIdByMessage,
  getStreamBuffer,
  getStreamSession,
  stashPendingStopEnvelope,
  streamSessionsForChat,
  takePendingStopEnvelopes,
} from '@/hooks/stream/streamRegistry';

// Token envelopes arrive ~10-50ms apart; 50ms batching (~20/s) avoids thrashing React/cache.
const STREAM_FLUSH_INTERVAL_MS = 50;

interface UseStreamCallbacksParams {
  messages: Message[];
  chatId: string | undefined;
  currentChat: Chat | undefined;
  queryClient: QueryClient;
  onContextUsageUpdate?: (data: ContextUsage, chatId?: string) => void;
  onPermissionRequest?: (request: PermissionRequest) => void;
  onElicitationRequest?: (request: ElicitationRequest) => void;
  onElicitationDismissed?: (requestId: string) => void;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setStreamState: Dispatch<SetStateAction<StreamState>>;
  setCurrentMessageId: Dispatch<SetStateAction<string | null>>;
  pendingStopRef: React.MutableRefObject<Set<string>>;
  onPendingUserMessageIdChange?: (id: string | null) => void;
}

interface UseStreamCallbacksResult {
  onEnvelope: (envelope: StreamEnvelope) => void;
  onComplete: (
    messageId?: string,
    streamId?: string,
    terminalKind?: 'complete' | 'cancelled',
    durationMs?: number | null,
  ) => void;
  onError: (error: Error, messageId?: string, streamId?: string) => void;
  onQueueProcess: (data: QueueProcessingData) => void;
  startStream: (
    request: StreamOptions['request'],
    signal?: AbortSignal,
  ) => Promise<{ messageId: string; checkpointId: string | null; worktreeCwd: string | null }>;
  replayStream: (messageId: string, afterSeq?: number) => Promise<string>;
  stopStream: (messageId: string) => Promise<void>;
  addMessageToCache: ReturnType<typeof useMessageCache>['addMessageToCache'];
  removeMessagesFromCache: ReturnType<typeof useMessageCache>['removeMessagesFromCache'];
  setPendingUserMessageId: (id: string | null) => void;
}

// SSE pipeline: buffer envelopes, flush on a coalescing timer, own start/replay/stop + terminal handlers.
export function useStreamCallbacks({
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
  onPendingUserMessageIdChange,
}: UseStreamCallbacksParams): UseStreamCallbacksResult {
  const optionsRef = useRef<{
    chatId: string;
    onEnvelope?: (envelope: StreamEnvelope) => void;
    onComplete?: (
      messageId?: string,
      streamId?: string,
      terminalKind?: 'complete' | 'cancelled',
      durationMs?: number | null,
    ) => void;
    onError?: (error: Error, messageId?: string, streamId?: string) => void;
    onQueueProcess?: (data: QueueProcessingData) => void;
  } | null>(null);

  const pendingUserMessageIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>(messages);
  messagesRef.current = messages;
  const timerIdsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const flushTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  const { addMessageToCache, removeMessagesFromCache } = useMessageCache({
    chatId,
    queryClient,
  });
  const notifyBackground = useBackgroundNotify();

  // Live state only when on-screen; always can write cache so off-screen progress survives switches.
  const flushBufferedContent = useCallback(
    (streamId: string, { writeToCache }: { writeToCache: boolean }) => {
      const buffer = getStreamBuffer(streamId);
      const session = getStreamSession(streamId);
      if (!buffer || !session) return;

      const update = buildContentFlushUpdate(streamId, buffer, session);

      if (session.chatId === chatIdRef.current) {
        setMessages((prevMessages) =>
          prevMessages.map((msg) => (msg.id === session.messageId ? update(msg) : msg)),
        );
      }

      if (writeToCache) {
        updateMessageInCacheForChat(queryClient, session.chatId, session.messageId, update);
      }
    },
    [setMessages, queryClient],
  );

  // Per-pane timers — each pane flushes into its own messages state.
  const scheduleContentFlush = useCallback(
    (streamId: string) => {
      const timers = flushTimersRef.current;
      if (timers.has(streamId)) {
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(streamId);
        flushBufferedContent(streamId, { writeToCache: true });
      }, STREAM_FLUSH_INTERVAL_MS);
      timers.set(streamId, timer);
    },
    [flushBufferedContent],
  );

  // Seed from existing message content so reconnections append rather than blank.
  const ensureBuffer = useCallback(
    (
      streamId: string,
      messageId: string,
      seq: number,
      streamChatId: string,
    ): StreamContentBuffer => {
      const existing = advanceStreamSession(streamId, messageId, seq, streamChatId);
      if (existing) {
        return existing;
      }

      // Cache fallback: post-switch envelopes can arrive before messages state is populated.
      let seedEvents: AssistantStreamEvent[] = [];
      let seedText = '';
      const existingMessage =
        (streamChatId === chatIdRef.current
          ? messagesRef.current.find((msg) => msg.id === messageId)
          : undefined) ?? findMessageInCache(queryClient, streamChatId, messageId);
      if (existingMessage) {
        const maybeEvents = existingMessage.content_render?.events;
        seedEvents = Array.isArray(maybeEvents) ? maybeEvents : [];
        seedText = existingMessage.content_text ?? '';
      }

      return createStreamSession(
        streamId,
        {
          messageId,
          lastSeq: seq,
          chatId: streamChatId,
          // Resolve now while chat query is warm — completion-time resolve can miss after gc.
          sandboxId: queryClient.getQueryData<Chat>(queryKeys.chat(streamChatId))?.sandbox_id,
        },
        seedEvents,
        seedText,
      );
    },
    [queryClient],
  );

  useEffect(() => {
    const flushTimers = flushTimersRef.current;
    return () => {
      timerIdsRef.current.forEach(clearTimeout);
      timerIdsRef.current = [];
      // Persist the buffered tail — the next envelope can be minutes away.
      for (const [streamId, timer] of flushTimers) {
        clearTimeout(timer);
        flushBufferedContent(streamId, { writeToCache: true });
      }
      flushTimers.clear();
    };
  }, [flushBufferedContent]);

  const setPendingUserMessageId = useCallback(
    (id: string | null) => {
      pendingUserMessageIdRef.current = id;
      onPendingUserMessageIdChange?.(id);
    },
    [onPendingUserMessageIdChange],
  );

  // Side-effect kinds inline; renderable content → buffer + coalesced flush.
  const onEnvelope = useCallback(
    (envelope: StreamEnvelope) => {
      if (pendingStopRef.current.has(envelope.messageId)) {
        stashPendingStopEnvelope(envelope.messageId, envelope);
        return;
      }

      if (pendingUserMessageIdRef.current && chatId === chatIdRef.current) {
        setPendingUserMessageId(null);
      }

      // Permissions go to the modal, not message content.
      if (envelope.kind === 'permission_request' && onPermissionRequest) {
        const payload = envelope.payload as Record<string, unknown>;
        const request_id = typeof payload.request_id === 'string' ? payload.request_id : undefined;
        const tool_name = typeof payload.tool_name === 'string' ? payload.tool_name : undefined;
        const tool_input =
          payload.tool_input && typeof payload.tool_input === 'object'
            ? (payload.tool_input as Record<string, unknown>)
            : undefined;
        const data = extractPayloadData(payload) ?? {};
        const options = Array.isArray(data.options) ? data.options : [];

        if (request_id && tool_name && tool_input) {
          onPermissionRequest({
            request_id,
            tool_name,
            tool_input,
            options,
            seq: envelope.seq,
          });
        }
        return;
      }

      // Elicitations block the turn like permissions do — inline form, not content.
      if (envelope.kind === 'elicitation_request' && onElicitationRequest) {
        const payload = envelope.payload as Record<string, unknown>;
        const request_id = typeof payload.request_id === 'string' ? payload.request_id : undefined;
        const data = extractPayloadData(payload);

        if (request_id && data) {
          onElicitationRequest({
            request_id,
            message: typeof data.message === 'string' ? data.message : '',
            tool_call_id: typeof data.tool_call_id === 'string' ? data.tool_call_id : null,
            requested_schema: (data.requested_schema ?? {}) as ElicitationSchema,
          });
        }
        return;
      }

      if (envelope.kind === 'elicitation_dismissed' && onElicitationDismissed) {
        const payload = envelope.payload as Record<string, unknown>;
        if (typeof payload.request_id === 'string') {
          onElicitationDismissed(payload.request_id);
        }
        return;
      }

      if (envelope.kind === 'system') {
        const payload = envelope.payload as Record<string, unknown>;
        const nestedData = extractPayloadData(payload);

        const eventChatId =
          typeof payload.chat_id === 'string'
            ? payload.chat_id
            : typeof nestedData?.chat_id === 'string'
              ? nestedData.chat_id
              : undefined;

        if (onContextUsageUpdate) {
          const contextUsage =
            (payload.context_usage as ContextUsage | undefined) ??
            (nestedData?.context_usage as ContextUsage | undefined);
          if (contextUsage) {
            onContextUsageUpdate(contextUsage, eventChatId);
          }
        }

        const worktreeCwd =
          typeof nestedData?.worktree_cwd === 'string' ? nestedData.worktree_cwd : undefined;
        if (worktreeCwd && chatId) {
          patchChatWorktreeCwd(queryClient, chatId, worktreeCwd);
        }

        return;
      }

      if (envelope.kind === 'tool_completed') {
        const tool = (envelope.payload as { tool?: ToolEventPayload })?.tool;
        if (tool?.name === 'EnterPlanMode' && chatId) {
          useChatSettingsStore.getState().setPermissionMode(chatId, 'plan');
        } else if (tool?.name === 'ExitPlanMode' && chatId) {
          if (tool.permission_mode) {
            // Payload types as string; backend emits a known PermissionMode.
            useChatSettingsStore
              .getState()
              .setPermissionMode(chatId, tool.permission_mode as PermissionMode);
          }
        }
      }

      const renderEvent = envelopeToRenderEvent(envelope);
      if (!renderEvent) {
        return;
      }

      const buffer = ensureBuffer(
        envelope.streamId,
        envelope.messageId,
        envelope.seq,
        envelope.chatId,
      );
      buffer.push(renderEvent);
      scheduleContentFlush(envelope.streamId);
    },
    [
      chatId,
      ensureBuffer,
      onContextUsageUpdate,
      onElicitationDismissed,
      onElicitationRequest,
      onPermissionRequest,
      pendingStopRef,
      queryClient,
      scheduleContentFlush,
      setPendingUserMessageId,
    ],
  );

  // Terminal complete: flush, clear session, side effects. Cache always; UI state only if active chat.
  const onComplete = useCallback(
    (
      messageId?: string,
      streamId?: string,
      terminalKind: 'complete' | 'cancelled' = 'complete',
      durationMs?: number | null,
    ) => {
      const resolvedStreamId = streamId ?? findStreamIdByMessage(messageId);
      const isCancelled = terminalKind === 'cancelled';
      const isCurrentChat = chatId === chatIdRef.current;
      const session = getStreamSession(resolvedStreamId);
      const sessionChatId = session?.chatId;
      const sessionSandboxId = session?.sandboxId;

      if (resolvedStreamId) {
        flushBufferedContent(resolvedStreamId, { writeToCache: true });
      }

      // Read before clearStreamSession drops the buffer holding it.
      const assistantText = resolvedStreamId
        ? extractAssistantText(getStreamBuffer(resolvedStreamId)?.getEvents() ?? [])
        : '';

      clearStreamSession(resolvedStreamId);

      const targetChatId = sessionChatId ?? chatId;

      // Finalize cache even off-screen so return within staleTime isn't stuck.
      if (messageId) {
        pendingStopRef.current.delete(messageId);
        takePendingStopEnvelopes(messageId);
        const finalizeMessage = (message: Message): Message => ({
          ...message,
          active_stream_id: null,
          stream_status: isCancelled ? 'interrupted' : 'completed',
          // Prefer complete-event duration so the rollup shows real time without refetch.
          duration_ms: durationMs ?? message.duration_ms,
        });
        if (targetChatId) {
          updateMessageInCacheForChat(queryClient, targetChatId, messageId, finalizeMessage);
        }
        if (isCurrentChat) {
          setMessages((prev) =>
            prev.map((msg) => (msg.id === messageId ? finalizeMessage(msg) : msg)),
          );
        }
      }

      // Off-screen completions would leave search stale for up to staleTime.
      queryClient.invalidateQueries({ queryKey: queryKeys.chatsSearchAll });

      // Server mutates title/updated_at/context during the turn — refresh even if off-screen.
      if (targetChatId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.chat(targetChatId), exact: true });
        // Server terminals only — an optimistic Stop races the unwind and
        // would refetch pre-terminal state over the local patch.
        if (streamId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.messages(targetChatId) });
        }
      }

      // Refresh sandbox caches even off-screen (incl. cancelled — real file/branch effects).
      const targetSandboxId =
        sessionSandboxId ?? (isCurrentChat ? currentChat?.sandbox_id : undefined);
      if (targetSandboxId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.sandbox.filesMetadataAll(targetSandboxId),
        });
        // reset (not remove) so open editors refetch; remove leaves stale buffers.
        queryClient.resetQueries({
          queryKey: queryKeys.sandbox.fileContentAll(targetSandboxId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.sandbox.gitBranchesAll(targetSandboxId),
        });
        void invalidateGitState(queryClient, targetSandboxId);
      }

      if (!isCancelled) {
        notifyBackground(targetChatId, (options) =>
          notifyStreamComplete({ ...options, message: assistantText }),
        );
      }

      if (!isCurrentChat) return;

      // Re-stamp read so initiation's updated_at bump doesn't re-flag unread.
      // Skip sub-threads routed through this pane that weren't being viewed.
      if (targetChatId && targetChatId === chatId) {
        void markChatViewed(queryClient, targetChatId);
      }

      setPendingUserMessageId(null);
      setStreamState('idle');
      setCurrentMessageId(null);

      timerIdsRef.current.forEach(clearTimeout);
      timerIdsRef.current = [];

      if (chatId) {
        if (currentChat?.parent_chat_id) {
          queryClient.invalidateQueries({ queryKey: [queryKeys.chats, 'infinite'] });
          queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
        }
        // Aggregation is a post-stream background task — wait before refetch.
        timerIdsRef.current.push(
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.contextUsage(chatId) });
          }, 6000),
        );
      }
    },
    [
      flushBufferedContent,
      chatId,
      currentChat?.sandbox_id,
      currentChat?.parent_chat_id,
      notifyBackground,
      pendingStopRef,
      queryClient,
      setCurrentMessageId,
      setMessages,
      setPendingUserMessageId,
      setStreamState,
    ],
  );

  const onError = useCallback(
    (streamError: Error, assistantMessageId?: string, streamId?: string) => {
      const resolvedStreamId = streamId ?? findStreamIdByMessage(assistantMessageId);
      const isCurrentChat = chatId === chatIdRef.current;
      const sessionChatId = getStreamSession(resolvedStreamId)?.chatId;

      if (resolvedStreamId) {
        flushBufferedContent(resolvedStreamId, { writeToCache: true });
      }
      clearStreamSession(resolvedStreamId);

      const targetChatId = sessionChatId ?? chatId;

      // Don't remove — already persisted; mirror backend snapshot so live UI matches refresh.
      if (assistantMessageId) {
        // Same drain as onComplete — a stop ending in error must not keep stashing.
        pendingStopRef.current.delete(assistantMessageId);
        takePendingStopEnvelopes(assistantMessageId);
        const markFailed = buildFailedMessageUpdate(streamError);
        if (targetChatId) {
          updateMessageInCacheForChat(queryClient, targetChatId, assistantMessageId, markFailed);
        }
        if (isCurrentChat) {
          setMessages((prev) =>
            prev.map((msg) => (msg.id === assistantMessageId ? markFailed(msg) : msg)),
          );
        }
      }

      // Same gate as onComplete — a connection-failure error has no streamId.
      if (targetChatId && streamId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.messages(targetChatId) });
      }

      if (!isCurrentChat) return;

      // Same read re-stamp as onComplete (watched failure is still seen activity).
      if (targetChatId && targetChatId === chatId) {
        void markChatViewed(queryClient, targetChatId);
      }

      if (!assistantMessageId) {
        toast.error(getStreamErrorMessage(streamError));
      }
      setStreamState('idle');
      setCurrentMessageId(null);
      setPendingUserMessageId(null);
    },
    [
      flushBufferedContent,
      chatId,
      pendingStopRef,
      queryClient,
      setCurrentMessageId,
      setMessages,
      setPendingUserMessageId,
      setStreamState,
    ],
  );

  // Backend picked up a queued follow-up: inject the new pair and flush prior-turn sessions.
  const onQueueProcess = useCallback(
    (data: QueueProcessingData) => {
      if (!chatId) return;
      const isCurrentChat = chatId === chatIdRef.current;

      // Queue continuation starts a new stream/message pair without terminal events
      // on the prior stream, so flush and drop stale per-stream session state.
      for (const [streamId, session] of streamSessionsForChat(chatId)) {
        if (session.messageId === data.assistantMessageId) {
          continue;
        }
        flushBufferedContent(streamId, { writeToCache: true });
        clearStreamSession(streamId);
      }

      // The prior turn's complete event is suppressed during a handoff, so stamp
      // its persisted duration here — otherwise the rollup shows plain "Worked".
      if (data.priorDurationMs != null) {
        const applyDuration = (message: Message): Message => ({
          ...message,
          duration_ms: data.priorDurationMs,
        });
        updateMessageInCacheForChat(queryClient, chatId, data.priorMessageId, applyDuration);
        if (isCurrentChat) {
          setMessages((prev) =>
            prev.map((msg) => (msg.id === data.priorMessageId ? applyDuration(msg) : msg)),
          );
        }
      }

      const userMessage: Message = {
        id: data.userMessageId,
        chat_id: chatId,
        role: 'user',
        content_text: data.content,
        content_render: {
          events: [{ type: 'user_text', text: data.content }],
        },
        last_seq: 0,
        active_stream_id: null,
        stream_status: 'completed',
        created_at: new Date().toISOString(),
        attachments: data.attachments || [],
        is_bot: false,
        model_id: null,
        duration_ms: null,
        checkpoint_id: null,
      };

      const assistantMessage: Message = {
        id: data.assistantMessageId,
        chat_id: chatId,
        role: 'assistant',
        content_text: '',
        content_render: createEmptyRenderSnapshot(),
        last_seq: 0,
        active_stream_id: null,
        stream_status: 'in_progress',
        created_at: new Date().toISOString(),
        model_id: data.modelId,
        attachments: [],
        is_bot: true,
        duration_ms: null,
        checkpoint_id: data.checkpointId,
      };

      // Cache even off-screen; single setQueryData for both msgs to avoid double churn.
      queryClient.setQueryData(
        queryKeys.messages(chatId),
        (oldData: { pages: PaginatedMessages[]; pageParams: unknown[] } | undefined) => {
          if (!oldData?.pages || oldData.pages.length === 0) return oldData;
          const items = [...oldData.pages[0].items];
          if (!items.some((msg) => msg.id === userMessage.id)) {
            items.unshift(userMessage);
          }
          if (!items.some((msg) => msg.id === assistantMessage.id)) {
            items.unshift(assistantMessage);
          }
          return {
            ...oldData,
            pages: oldData.pages.map((page, idx) => (idx === 0 ? { ...page, items } : page)),
          };
        },
      );

      if (!isCurrentChat) return;

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setCurrentMessageId(data.assistantMessageId);
      // Anchor handshake keys off pending user message id (same as normal send).
      setPendingUserMessageId(data.userMessageId);
    },
    [
      flushBufferedContent,
      chatId,
      queryClient,
      setMessages,
      setCurrentMessageId,
      setPendingUserMessageId,
    ],
  );

  // startStream/replayStream stay stable (queryClient-only deps); dispatch via freshest closures.
  optionsRef.current = chatId ? { chatId, onEnvelope, onComplete, onError, onQueueProcess } : null;

  const startStream = useCallback(
    async (
      request: StreamOptions['request'],
      signal?: AbortSignal,
    ): Promise<{ messageId: string; checkpointId: string | null; worktreeCwd: string | null }> => {
      const currentOptions = optionsRef.current;
      if (!currentOptions) {
        throw new Error('Stream options not available');
      }

      const streamOptions: StreamOptions = {
        chatId: currentOptions.chatId,
        request,
        signal,
        onEnvelope: currentOptions.onEnvelope,
        onComplete: currentOptions.onComplete,
        onError: currentOptions.onError,
        onQueueProcess: currentOptions.onQueueProcess,
      };

      const result = await streamService.startStream(streamOptions);
      // First worktree turn creates during send — patch now so UI doesn't wait for config event.
      if (result.worktreeCwd) {
        patchChatWorktreeCwd(queryClient, currentOptions.chatId, result.worktreeCwd);
      }
      return result;
    },
    [queryClient],
  );

  const replayStream = useCallback(
    async (messageId: string, afterSeq?: number): Promise<string> => {
      const currentOptions = optionsRef.current;
      if (!currentOptions) {
        throw new Error('Stream options not available');
      }

      return streamService.replayStream({
        chatId: currentOptions.chatId,
        messageId,
        afterSeq,
        onEnvelope: currentOptions.onEnvelope,
        onComplete: currentOptions.onComplete,
        onError: currentOptions.onError,
        onQueueProcess: currentOptions.onQueueProcess,
      });
    },
    [],
  );

  const stopStream = useCallback(
    async (messageId: string) => {
      if (!chatId) return;
      try {
        const locallyFinalized = await streamService.stopStreamByMessage(chatId, messageId);
        if (!locallyFinalized) {
          onComplete(messageId, undefined, 'cancelled');
        }
      } catch (error) {
        pendingStopRef.current.delete(messageId);
        for (const envelope of takePendingStopEnvelopes(messageId)) {
          onEnvelope(envelope);
        }
        throw error;
      }
    },
    [chatId, onComplete, onEnvelope, pendingStopRef],
  );

  return {
    onEnvelope,
    onComplete,
    onError,
    onQueueProcess,
    startStream,
    replayStream,
    stopStream,
    addMessageToCache,
    removeMessagesFromCache,
    setPendingUserMessageId,
  };
}
