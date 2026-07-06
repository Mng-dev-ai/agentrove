import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { QueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { StreamContentBuffer, type ContentRenderSnapshot } from '@/utils/stream';
import { notifyStreamComplete } from '@/utils/notifications';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { markChatViewed, patchChatInCache } from '@/hooks/queries/useChatQueries';
import { invalidateGitState } from '@/hooks/queries/useSandboxQueries';
import { useSettingsQuery } from '@/hooks/queries/useSettingsQueries';
import type {
  AssistantStreamEvent,
  Chat,
  ContextUsage,
  Message,
  PermissionRequest,
} from '@/types/chat.types';
import type { ToolEventPayload } from '@/types/tools.types';
import {
  StreamProcessingError,
  type QueueProcessingData,
  type StreamEnvelope,
  type StreamState,
} from '@/types/stream.types';
import { useMessageCache } from '@/hooks/useMessageCache';
import { streamService } from '@/services/streamService';
import type { StreamOptions } from '@/services/streamService';
import { useChatSettingsStore } from '@/store/chatSettingsStore';
import type { PaginatedMessages } from '@/types/api.types';

// Batching window for streaming content updates. Envelopes arrive at token-level
// granularity (~10-50ms apart); flushing on every token would thrash React state
// and the query cache. 50ms keeps the text cadence smooth (~20 updates/sec) —
// affordable because memoized markdown blocks and segments mean each flush only
// re-renders the growing tail of the message.
const STREAM_FLUSH_INTERVAL_MS = 50;

// Cross-chat cache mutators: unlike the hook-scoped useMessageCache (which
// closes over the currently viewed chatId), these target a specific chat by
// explicit parameter — needed when off-screen streams flush or finalize into
// a chat the user has navigated away from.
function updateMessageInCacheForChat(
  queryClient: QueryClient,
  chatId: string,
  messageId: string,
  updater: (msg: Message) => Message,
) {
  queryClient.setQueryData(
    queryKeys.messages(chatId),
    (oldData: { pages: PaginatedMessages[]; pageParams: unknown[] } | undefined) => {
      if (!oldData?.pages) return oldData;
      return {
        ...oldData,
        pages: oldData.pages.map((page: PaginatedMessages) => ({
          ...page,
          items: page.items.map((msg: Message) => (msg.id === messageId ? updater(msg) : msg)),
        })),
      };
    },
  );
}

function patchChatWorktreeCwd(queryClient: QueryClient, chatId: string, worktreeCwd: string) {
  patchChatInCache(queryClient, chatId, (chat) =>
    chat.worktree_cwd !== worktreeCwd ? { ...chat, worktree_cwd: worktreeCwd } : chat,
  );
}

function findMessageInCache(
  queryClient: QueryClient,
  chatId: string,
  messageId: string,
): Message | undefined {
  const data = queryClient.getQueryData<{ pages: PaginatedMessages[] }>(queryKeys.messages(chatId));
  if (!data?.pages) return undefined;
  for (const page of data.pages) {
    const msg = page.items.find((m) => m.id === messageId);
    if (msg) return msg;
  }
  return undefined;
}

function createEmptyRenderSnapshot(): ContentRenderSnapshot {
  return { events: [] };
}

function getStreamErrorMessage(streamError: Error): string {
  if (streamError instanceof StreamProcessingError) {
    const originalMessage = streamError.originalError?.message;
    if (originalMessage?.trim()) return originalMessage;
  }
  return streamError.message || 'An error occurred';
}

function buildFailedMessageUpdate(streamError: Error): (msg: Message) => Message {
  const errorMessage = getStreamErrorMessage(streamError);

  return (msg: Message): Message => {
    const existingEvents = Array.isArray(msg.content_render?.events)
      ? msg.content_render.events
      : [];
    const nextEvents = [
      ...existingEvents,
      { type: 'assistant_text', text: '\n\nError: ' + errorMessage },
    ];

    return {
      ...msg,
      content_text: msg.content_text || errorMessage,
      content_render: { events: nextEvents },
      active_stream_id: null,
      stream_status: 'failed',
    };
  };
}

function buildContentFlushUpdate(
  streamId: string,
  buffer: StreamContentBuffer,
  session: StreamSessionState,
): (msg: Message) => Message {
  const nextRender = buffer.snapshot();
  const nextText = buffer.getContentText();
  const nextSeq = session.lastSeq;
  return (msg: Message): Message => ({
    ...msg,
    content_text: nextText,
    content_render: nextRender,
    last_seq: nextSeq,
    active_stream_id: streamId,
  });
}

function extractPayloadData(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  return payload.data && typeof payload.data === 'object'
    ? (payload.data as Record<string, unknown>)
    : undefined;
}

// Side-effect-only envelope kinds (system, permission_request) are handled
// upstream in onEnvelope — this function only converts content-bearing kinds
// into the AssistantStreamEvent shape consumed by the buffer.
function envelopeToRenderEvent(envelope: StreamEnvelope): AssistantStreamEvent | null {
  const payload = envelope.payload as Record<string, unknown>;

  switch (envelope.kind) {
    case 'assistant_text': {
      const text = typeof payload.text === 'string' ? payload.text : '';
      if (!text) return null;
      return { type: 'assistant_text', text };
    }
    case 'assistant_thinking': {
      const thinking = typeof payload.thinking === 'string' ? payload.thinking : '';
      if (!thinking) return null;
      return { type: 'assistant_thinking', thinking };
    }
    case 'tool_started':
    case 'tool_completed':
    case 'tool_failed': {
      if (!payload.tool || typeof payload.tool !== 'object') {
        return null;
      }
      return {
        type: envelope.kind,
        tool: payload.tool as ToolEventPayload,
      } as AssistantStreamEvent;
    }
    case 'prompt_suggestions': {
      const raw = payload.suggestions;
      if (!Array.isArray(raw)) return null;
      const suggestions = raw.filter((item): item is string => typeof item === 'string');
      if (suggestions.length === 0) return null;
      return { type: 'prompt_suggestions', suggestions };
    }
    default:
      return null;
  }
}

interface UseStreamCallbacksParams {
  messages: Message[];
  chatId: string | undefined;
  currentChat: Chat | undefined;
  queryClient: QueryClient;
  onContextUsageUpdate?: (data: ContextUsage, chatId?: string) => void;
  onPermissionRequest?: (request: PermissionRequest) => void;
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
  ) => Promise<{ messageId: string; checkpointId: string | null }>;
  replayStream: (messageId: string, afterSeq?: number) => Promise<string>;
  stopStream: (messageId: string) => Promise<void>;
  updateMessageInCache: ReturnType<typeof useMessageCache>['updateMessageInCache'];
  addMessageToCache: ReturnType<typeof useMessageCache>['addMessageToCache'];
  removeMessagesFromCache: ReturnType<typeof useMessageCache>['removeMessagesFromCache'];
  setPendingUserMessageId: (id: string | null) => void;
}

interface StreamSessionState {
  messageId: string;
  lastSeq: number;
  chatId: string;
  // Captured at session creation so an off-screen completion can invalidate the
  // right sandbox's caches — the user may be viewing a different chat by then.
  sandboxId: string | undefined;
}

// Core streaming pipeline: receives raw SSE envelopes, buffers renderable
// content per stream, and flushes batched updates to React state and the query
// cache on a coalescing timer. Also owns the start/replay/stop lifecycle
// and the terminal handlers (complete, error, queue continuation).
export function useStreamCallbacks({
  messages,
  chatId,
  currentChat,
  queryClient,
  onContextUsageUpdate,
  onPermissionRequest,
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
  const timerIdsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const buffersRef = useRef<Map<string, StreamContentBuffer>>(new Map());
  const flushTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const streamSessionsRef = useRef<Map<string, StreamSessionState>>(new Map());
  const pendingStopEnvelopesRef = useRef<Map<string, StreamEnvelope[]>>(new Map());
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;

  const { updateMessageInCache, addMessageToCache, removeMessagesFromCache } = useMessageCache({
    chatId,
    queryClient,
  });
  const { data: settings } = useSettingsQuery();

  const clearStreamSession = useCallback((streamId: string | undefined) => {
    if (!streamId) return;

    const flushTimer = flushTimersRef.current.get(streamId);
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimersRef.current.delete(streamId);
    }

    buffersRef.current.delete(streamId);
    streamSessionsRef.current.delete(streamId);
  }, []);

  const findStreamIdByMessage = useCallback((messageId?: string): string | undefined => {
    if (!messageId) return undefined;

    for (const [streamId, session] of streamSessionsRef.current.entries()) {
      if (session.messageId === messageId) {
        return streamId;
      }
    }

    return undefined;
  }, []);

  const replayPendingStopEnvelopes = useCallback((messageId: string) => {
    const envelopes = pendingStopEnvelopesRef.current.get(messageId);
    pendingStopEnvelopesRef.current.delete(messageId);
    return envelopes ?? [];
  }, []);

  // Writes the buffer's collected tokens to React state (live chat) and/or
  // the query cache (so navigating away and back preserves progress). Only touches
  // React state when the session's chat is on screen — off-screen streams still
  // write to the cache so content isn't lost on chat switch.
  const flushBufferedContent = useCallback(
    (streamId: string, { writeToCache }: { writeToCache: boolean }) => {
      const buffer = buffersRef.current.get(streamId);
      const session = streamSessionsRef.current.get(streamId);
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

  // Coalescing timer: only one pending flush per stream. Multiple envelopes arriving
  // within the same window are batched into a single flushBufferedContent call.
  const scheduleContentFlush = useCallback(
    (streamId: string) => {
      if (flushTimersRef.current.has(streamId)) {
        return;
      }

      const timer = setTimeout(() => {
        flushTimersRef.current.delete(streamId);
        flushBufferedContent(streamId, { writeToCache: true });
      }, STREAM_FLUSH_INTERVAL_MS);

      flushTimersRef.current.set(streamId, timer);
    },
    [flushBufferedContent],
  );

  // Returns (or creates) the content buffer for a stream. On first call for a
  // given streamId, seeds the buffer from the message's existing content so that
  // reconnections append to prior content rather than starting from blank.
  const ensureBuffer = useCallback(
    (
      streamId: string,
      messageId: string,
      seq: number,
      streamChatId: string,
    ): StreamContentBuffer => {
      const existing = buffersRef.current.get(streamId);
      if (existing) {
        const existingSession = streamSessionsRef.current.get(streamId);
        if (existingSession) {
          existingSession.lastSeq = Math.max(existingSession.lastSeq, seq);
          existingSession.messageId = messageId;
          existingSession.chatId = streamChatId;
        }
        return existing;
      }

      // Seed from the on-screen message (fast path) or the query cache (off-screen chat).
      // Fall back to the cache when the on-screen lookup misses: right after a chat
      // switch an envelope can arrive before the remounted view has populated
      // messages state, and seeding empty would truncate the in-progress message.
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

      const buffer = new StreamContentBuffer(seedEvents, seedText);
      buffersRef.current.set(streamId, buffer);
      streamSessionsRef.current.set(streamId, {
        messageId,
        lastSeq: seq,
        chatId: streamChatId,
        // The chat query is warm here (the stream was just started/replayed from
        // it); resolving at completion time instead could miss after gc eviction.
        sandboxId: queryClient.getQueryData<Chat>(queryKeys.chat(streamChatId))?.sandbox_id,
      });

      return buffer;
    },
    [queryClient],
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const flushTimers = flushTimersRef.current;
    const buffers = buffersRef.current;
    const streamSessions = streamSessionsRef.current;
    const pendingStopEnvelopes = pendingStopEnvelopesRef.current;

    return () => {
      timerIdsRef.current.forEach(clearTimeout);
      timerIdsRef.current = [];

      // Flush any pending content to the query cache before clearing,
      // so content already cursor-acked in chatStorage is not lost on unmount.
      for (const [streamId, timer] of flushTimers.entries()) {
        clearTimeout(timer);
        const buffer = buffers.get(streamId);
        const session = streamSessions.get(streamId);
        if (buffer && session) {
          const update = buildContentFlushUpdate(streamId, buffer, session);
          updateMessageInCacheForChat(queryClient, session.chatId, session.messageId, update);
        }
      }
      flushTimers.clear();

      buffers.clear();
      streamSessions.clear();
      pendingStopEnvelopes.clear();
    };
  }, [queryClient]);

  const setPendingUserMessageId = useCallback(
    (id: string | null) => {
      pendingUserMessageIdRef.current = id;
      onPendingUserMessageIdChange?.(id);
    },
    [onPendingUserMessageIdChange],
  );

  // Central dispatch for every envelope arriving from the EventSource. Handles
  // side-effect-only events (permissions, system metadata, plan mode transitions)
  // inline, then delegates renderable content (text, thinking, tools) to the
  // buffer → scheduleContentFlush pipeline for batched UI updates.
  const onEnvelope = useCallback(
    (envelope: StreamEnvelope) => {
      if (pendingStopRef.current.has(envelope.messageId)) {
        const envelopes = pendingStopEnvelopesRef.current.get(envelope.messageId) ?? [];
        envelopes.push(envelope);
        pendingStopEnvelopesRef.current.set(envelope.messageId, envelopes);
        return;
      }

      // First envelope for a message clears the optimistic "sending…" indicator.
      if (pendingUserMessageIdRef.current && chatId === chatIdRef.current) {
        setPendingUserMessageId(null);
      }

      // Permission requests are dispatched directly to the modal system and
      // never accumulate into the message content — early return skips the pipeline.
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
          useChatSettingsStore.getState().setPlanMode(chatId, true);
        } else if (tool?.name === 'ExitPlanMode' && chatId) {
          if (tool.permission_mode) {
            useChatSettingsStore.getState().setPermissionMode(chatId, tool.permission_mode);
          }
          useChatSettingsStore.getState().setPlanMode(chatId, false);
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

      const session = streamSessionsRef.current.get(envelope.streamId);
      if (session) {
        session.lastSeq = Math.max(session.lastSeq, envelope.seq);
        session.messageId = envelope.messageId;
      }

      scheduleContentFlush(envelope.streamId);
    },
    [
      chatId,
      ensureBuffer,
      onContextUsageUpdate,
      onPermissionRequest,
      pendingStopRef,
      queryClient,
      scheduleContentFlush,
      setPendingUserMessageId,
    ],
  );

  // Terminal handler for a finished stream. Flushes any buffered content,
  // clears per-stream session state, marks the message as completed/interrupted,
  // and triggers post-stream side effects (notifications, file metadata refresh,
  // usage/context invalidation). Runs for both on-screen and off-screen chats
  // so the cache stays consistent, but only resets UI state for the active chat.
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
      // Capture before clearStreamSession deletes it
      const session = resolvedStreamId
        ? streamSessionsRef.current.get(resolvedStreamId)
        : undefined;
      const sessionChatId = session?.chatId;
      const sessionSandboxId = session?.sandboxId;

      if (resolvedStreamId) {
        flushBufferedContent(resolvedStreamId, { writeToCache: true });
      }

      // Session cleanup is stateless and safe for any chat; always run it.
      clearStreamSession(resolvedStreamId);

      const targetChatId = sessionChatId ?? chatId;

      // Cache finalization must run even for off-screen chats so returning
      // to the chat within the staleTime window doesn't show a stuck message.
      if (messageId) {
        pendingStopRef.current.delete(messageId);
        pendingStopEnvelopesRef.current.delete(messageId);
        const finalizeMessage = (message: Message): Message => ({
          ...message,
          active_stream_id: null,
          stream_status: isCancelled ? 'interrupted' : 'completed',
          // Backend records the run duration at the terminal snapshot and ships
          // it on the complete event, so the rollup shows the real time without
          // waiting for a refetch. Older messages persisted before this carry null.
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

      // Invalidate the chat-search cache regardless of whether the completed
      // stream belongs to the on-screen chat — otherwise off-screen completions
      // (background turns) leave search results stale for up to staleTime.
      queryClient.invalidateQueries({ queryKey: queryKeys.chatsSearchAll });

      // Chat metadata (title, updated_at, context usage) is mutated server-side
      // during the turn, so it must refresh even when the completion lands while
      // the user is viewing another chat.
      if (targetChatId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.chat(targetChatId), exact: true });
      }

      // Sandbox state (files, branches) is mutated server-side during the turn,
      // so refresh it even when the completion lands off-screen — the long-lived
      // file caches would otherwise serve stale content when the user returns to
      // that chat. Cancelled runs still leave real file/branch side effects, so
      // this is not kind-gated — only the notification below is.
      const targetSandboxId =
        sessionSandboxId ?? (isCurrentChat ? currentChat?.sandbox_id : undefined);
      if (targetSandboxId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.sandbox.filesMetadataAll(targetSandboxId),
        });
        // Reset, not remove — remove doesn't refetch active observers, so an
        // open editor file would keep showing the pre-turn content.
        queryClient.resetQueries({
          queryKey: queryKeys.sandbox.fileContentAll(targetSandboxId),
        });
        // Agent may have switched/created a branch during the turn (e.g. `git checkout -b`),
        // so refresh the branch list to keep the UI in sync with HEAD.
        queryClient.invalidateQueries({
          queryKey: queryKeys.sandbox.gitBranchesAll(targetSandboxId),
        });
        // The turn's file edits change git state (and the agent may have
        // committed mid-turn) — refresh diff, baselines, and change indicators.
        void invalidateGitState(queryClient, targetSandboxId);
      }

      if (!isCurrentChat) return;

      // The turn bumped updated_at at initiation and the user watched it finish —
      // re-stamp the read marker so a later sidebar refetch doesn't flag it unread.
      // Sub-thread completions routed through this pane weren't being viewed; skip.
      if (targetChatId && targetChatId === chatId) {
        void markChatViewed(queryClient, targetChatId);
      }

      setPendingUserMessageId(null);
      setStreamState('idle');
      setCurrentMessageId(null);

      if (!isCancelled && (settings?.notifications_enabled ?? true)) {
        void notifyStreamComplete();
      }

      timerIdsRef.current.forEach(clearTimeout);
      timerIdsRef.current = [];

      if (chatId) {
        if (currentChat?.parent_chat_id) {
          queryClient.invalidateQueries({ queryKey: [queryKeys.chats, 'infinite'] });
          queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
        }
        // Context usage aggregation runs as a background task after the stream
        // completes; 6s gives it time to finish before we refetch.
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
      clearStreamSession,
      currentChat?.sandbox_id,
      currentChat?.parent_chat_id,
      queryClient,
      findStreamIdByMessage,
      setCurrentMessageId,
      setMessages,
      setPendingUserMessageId,
      setStreamState,
      settings?.notifications_enabled,
    ],
  );

  const onError = useCallback(
    (streamError: Error, assistantMessageId?: string, streamId?: string) => {
      const resolvedStreamId = streamId ?? findStreamIdByMessage(assistantMessageId);
      const isCurrentChat = chatId === chatIdRef.current;
      const sessionChatId = resolvedStreamId
        ? streamSessionsRef.current.get(resolvedStreamId)?.chatId
        : undefined;

      if (resolvedStreamId) {
        flushBufferedContent(resolvedStreamId, { writeToCache: true });
      }
      clearStreamSession(resolvedStreamId);

      const targetChatId = sessionChatId ?? chatId;

      // Mark the assistant message as failed instead of removing it —
      // the user message and assistant message are already persisted in
      // the DB by the time the SSE error event arrives. Mirror the backend's
      // persisted snapshot update here so the live UI matches a refreshed chat.
      if (assistantMessageId) {
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

      if (!isCurrentChat) return;

      // Same read re-stamp as onComplete — a watched failure is still seen
      // activity, and the initiation bump would otherwise flag the chat unread.
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
      clearStreamSession,
      queryClient,
      findStreamIdByMessage,
      setCurrentMessageId,
      setMessages,
      setPendingUserMessageId,
      setStreamState,
    ],
  );

  // Handles queue continuation — when the backend picks up a queued follow-up
  // message, this injects the new user+assistant message pair into both the cache
  // and React state, and flushes any stale sessions from the previous turn.
  const onQueueProcess = useCallback(
    (data: QueueProcessingData) => {
      if (!chatId) return;
      const isCurrentChat = chatId === chatIdRef.current;

      // Queue continuation starts a new stream/message pair without terminal events
      // on the prior stream, so flush and drop stale per-stream session state.
      for (const [streamId, session] of Array.from(streamSessionsRef.current.entries())) {
        if (session.chatId !== chatId || session.messageId === data.assistantMessageId) {
          continue;
        }
        flushBufferedContent(streamId, { writeToCache: true });
        clearStreamSession(streamId);
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

      // Cache updates must run even for off-screen chats so returning
      // within the staleTime window shows the queued continuation messages.
      // Batch both messages into a single setQueryData call to avoid double
      // cache churn and subscriber notifications.
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
    },
    [
      flushBufferedContent,
      chatId,
      clearStreamSession,
      queryClient,
      setMessages,
      setCurrentMessageId,
    ],
  );

  // Stash the latest callbacks in a ref so startStream/replayStream — which are
  // intentionally stable (only the stable queryClient in deps) to avoid
  // re-registering the EventSource — always dispatch through the freshest closures.
  useEffect(() => {
    optionsRef.current = chatId
      ? { chatId, onEnvelope, onComplete, onError, onQueueProcess }
      : null;
  }, [chatId, onEnvelope, onComplete, onError, onQueueProcess]);

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
      // A first worktree turn creates the worktree during the send request —
      // patch the cache now so branch/terminal/editor UI switches immediately
      // instead of waiting for the stream config event.
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
        for (const envelope of replayPendingStopEnvelopes(messageId)) {
          onEnvelope(envelope);
        }
        throw error;
      }
    },
    [chatId, onComplete, onEnvelope, pendingStopRef, replayPendingStopEnvelopes],
  );

  return {
    onEnvelope,
    onComplete,
    onError,
    onQueueProcess,
    startStream,
    replayStream,
    stopStream,
    updateMessageInCache,
    addMessageToCache,
    removeMessagesFromCache,
    setPendingUserMessageId,
  };
}
