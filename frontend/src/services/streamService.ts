import { useStreamStore } from '@/store/streamStore';
import { useMessageQueueStore } from '@/store/messageQueueStore';
import type { ChatRequest } from '@/types/chat.types';
import type { ToolEventPayload } from '@/types/tools.types';
import type {
  ActiveStream,
  ApiStreamResponse,
  QueueProcessingData,
  StreamEnvelope,
} from '@/types/stream.types';
import { StreamProcessingError } from '@/types/stream.types';
import { chatService } from '@/services/chatService';
import { streamConnection } from '@/services/streamConnection';
import { logger } from '@/utils/logger';
import { chatStorage } from '@/utils/storage';

export interface StreamOptions {
  chatId: string;
  request: ChatRequest;
  signal?: AbortSignal;
  onEnvelope?: (envelope: StreamEnvelope) => void;
  onComplete?: (
    messageId?: string,
    streamId?: string,
    terminalKind?: 'complete' | 'cancelled',
    durationMs?: number | null,
  ) => void;
  onError?: (error: Error, messageId?: string, streamId?: string) => void;
  onQueueProcess?: (data: QueueProcessingData) => void;
}

interface StreamReconnectOptions {
  chatId: string;
  messageId: string;
  afterSeq?: number;
  onEnvelope?: (envelope: StreamEnvelope) => void;
  onComplete?: (
    messageId?: string,
    streamId?: string,
    terminalKind?: 'complete' | 'cancelled',
    durationMs?: number | null,
  ) => void;
  onError?: (error: Error, messageId?: string, streamId?: string) => void;
  onQueueProcess?: (data: QueueProcessingData) => void;
}

class StreamService {
  private readonly maxRecentSeqPerChat = 4096;
  private readonly recentSeqByChat = new Map<string, Set<number>>();

  constructor() {
    streamConnection.configure({
      onEnvelopeData: (raw) => this.handleEnvelopeData(raw),
      onConnectionFailure: (chatIds) => this.failStreamsForChats(chatIds),
    });
  }

  private parseStreamEvent<T>(data: string): T | null {
    try {
      return JSON.parse(data) as T;
    } catch (err) {
      logger.error('Stream event parsing failed', 'streamService', err);
      return null;
    }
  }

  private cleanupStream(
    streamId: string,
    error?: Error,
    messageId?: string,
    streamPublicId?: string,
  ): void {
    const currentStream = useStreamStore.getState().getStream(streamId);
    if (!currentStream) return;

    const errorCallback = currentStream.callbacks?.onError;
    const streamMessageId = currentStream.messageId ?? messageId;

    useStreamStore.getState().removeStream(streamId);

    if (error && errorCallback) {
      errorCallback(error, streamMessageId, streamPublicId);
    }
  }

  private markSeqSeen(chatId: string, seq: number): boolean {
    let seen = this.recentSeqByChat.get(chatId);
    if (!seen) {
      seen = new Set<number>();
      this.recentSeqByChat.set(chatId, seen);
    }

    if (seen.has(seq)) {
      return false;
    }

    seen.add(seq);

    if (seen.size > this.maxRecentSeqPerChat) {
      const overflow = seen.size - this.maxRecentSeqPerChat;
      let removed = 0;
      for (const value of seen) {
        seen.delete(value);
        removed += 1;
        if (removed >= overflow) {
          break;
        }
      }
    }

    return true;
  }

  private maybeHandleQueueEvent(envelope: StreamEnvelope, chatId: string): void {
    if (envelope.kind !== 'queue_processing') return;

    const payload = envelope.payload as {
      queued_message_id?: string;
      user_message_id?: string;
      assistant_message_id?: string;
      checkpoint_id?: string | null;
      content?: string;
      model_id: string;
      prior_duration_ms?: number | null;
      attachments?: Array<{
        id: string;
        message_id: string;
        file_url: string;
        file_type: 'image' | 'pdf' | 'xlsx';
        filename?: string;
        created_at: string;
      }>;
    };

    if (!payload?.queued_message_id || !payload?.assistant_message_id) return;

    useMessageQueueStore.getState().removeLocalOnly(chatId, payload.queued_message_id);

    const stream = useStreamStore.getState().getStreamByChat(chatId);
    if (!stream) return;

    if (payload.assistant_message_id !== stream.messageId) {
      useStreamStore
        .getState()
        .updateStreamMessageId(chatId, stream.messageId, payload.assistant_message_id);
    }

    if (stream.callbacks?.onQueueProcess && payload.user_message_id && payload.content) {
      stream.callbacks.onQueueProcess({
        queuedMessageId: payload.queued_message_id,
        userMessageId: payload.user_message_id,
        assistantMessageId: payload.assistant_message_id,
        checkpointId: payload.checkpoint_id ?? null,
        content: payload.content,
        modelId: payload.model_id,
        attachments: payload.attachments,
        // The handoff envelope is emitted by the finishing stream, so its
        // messageId is the prior turn's assistant message.
        priorMessageId: envelope.messageId,
        priorDurationMs:
          typeof payload.prior_duration_ms === 'number' ? payload.prior_duration_ms : null,
      });
    }
  }

  private handleEnvelopeData(raw: string): void {
    const parsed = this.parseStreamEvent<StreamEnvelope>(raw);
    if (!parsed?.chatId) return;
    const chatId = parsed.chatId;

    // The multiplexed feed carries every stream of the user, including chats with
    // no client-side stream registered (e.g. background sub-threads). Those must
    // be ignored entirely — marking their seqs seen or advancing the chatStorage
    // cursor would make a later replay of that chat skip its content.
    const currentStream = useStreamStore.getState().getStreamByChat(chatId);
    if (!currentStream) return;
    const streamId = currentStream.id;

    const seq = Number(parsed.seq);
    if (!Number.isFinite(seq) || seq <= 0) {
      return;
    }

    if (!this.markSeqSeen(chatId, seq)) {
      return;
    }

    const lastSeq = Number(chatStorage.getEventId(chatId) || 0);
    if (seq > lastSeq) {
      chatStorage.setEventId(chatId, String(seq));
    }

    // Queue handoff events are fully owned by maybeHandleQueueEvent — routing them
    // on to onEnvelope would clear the pending id onQueueProcess just set for the
    // queued turn's anchor, and nothing downstream consumes this kind anyway.
    if (parsed.kind === 'queue_processing') {
      this.maybeHandleQueueEvent(parsed, chatId);
      return;
    }

    const isForActiveMessage = parsed.messageId === currentStream.messageId;
    if (!isForActiveMessage) {
      return;
    }

    // Feeds the landing-page "last tool call" title; after the active-message
    // guard so replayed envelopes for a stale turn can't overwrite it.
    if (
      parsed.kind === 'tool_started' &&
      parsed.payload.tool &&
      typeof parsed.payload.tool === 'object'
    ) {
      const tool = parsed.payload.tool as ToolEventPayload;
      const toolTitle = tool.title || tool.name;
      if (toolTitle) {
        useStreamStore.getState().setLastToolTitle(chatId, toolTitle);
      }
    }

    currentStream.callbacks?.onEnvelope?.(parsed);

    if (parsed.kind === 'complete' || parsed.kind === 'cancelled') {
      const { callbacks } = currentStream;
      const durationMs =
        typeof parsed.payload?.duration_ms === 'number' ? parsed.payload.duration_ms : null;
      useStreamStore.getState().removeStream(streamId);
      // Cancelled turns skip the sidebar "Done" badge — only a successful finish earns it
      if (parsed.kind === 'complete') {
        useStreamStore.getState().markCompleted(chatId);
      }
      callbacks?.onComplete?.(parsed.messageId, parsed.streamId, parsed.kind, durationMs);
      return;
    }

    if (parsed.kind === 'error') {
      const message =
        typeof parsed.payload?.error === 'string' ? parsed.payload.error : 'An error occurred';
      const wrappedError = new StreamProcessingError(
        'Error processing completion stream',
        new Error(message),
      );
      this.cleanupStream(streamId, wrappedError, parsed.messageId, parsed.streamId);
    }
  }

  // Invoked when the shared connection gives up reconnecting — every stream
  // riding it is unreachable, so fail them all like a fatal transport error.
  private failStreamsForChats(chatIds: string[]): void {
    for (const chatId of chatIds) {
      const stream = useStreamStore.getState().getStreamByChat(chatId);
      if (!stream) continue;
      this.cleanupStream(
        stream.id,
        new StreamProcessingError('Stream connection error'),
        stream.messageId,
      );
    }
  }

  private finalizeStreamAsCancelled(stream: ActiveStream): void {
    stream.callbacks?.onComplete?.(
      stream.messageId,
      undefined,
      'cancelled',
      Date.now() - stream.startTime,
    );
    useStreamStore.getState().abortStream(stream.id);
  }

  // Registering the stream opens the shared connection if it isn't already, and
  // the replay request covers the already-open case — events published before
  // this registration (send request window, pre-reconnect backlog) would
  // otherwise be dropped, since an open feed only replays chats from its
  // open-time cursors. The resume point is the chat's chatStorage cursor.
  private registerAndReplay(
    chatId: string,
    messageId: string,
    options: StreamOptions | StreamReconnectOptions,
  ): void {
    useStreamStore.getState().addStream({
      id: crypto.randomUUID(),
      chatId,
      messageId,
      startTime: Date.now(),
      isActive: true,
      callbacks: {
        onEnvelope: options.onEnvelope,
        onComplete: options.onComplete,
        onError: options.onError,
        onQueueProcess: options.onQueueProcess,
      },
    });
    streamConnection.requestReplay(chatId);
  }

  async startStream(options: StreamOptions): Promise<ApiStreamResponse> {
    const { messageId, checkpointId, worktreeCwd } = await chatService.createCompletion(
      options.request,
      options.signal,
    );
    this.registerAndReplay(options.chatId, messageId, options);
    return { messageId, checkpointId, worktreeCwd };
  }

  async stopStreamByMessage(chatId: string, messageId: string): Promise<boolean> {
    const stream = useStreamStore.getState().getStreamByChatAndMessage(chatId, messageId);
    await chatService.stopStream(chatId);

    if (stream) {
      this.finalizeStreamAsCancelled(stream);
      return true;
    }
    return false;
  }

  async replayStream(options: StreamReconnectOptions): Promise<string> {
    // A from-zero replay rebuilds the whole message, so the dedup window must
    // not swallow the re-sent seqs. The actual resume point comes from the
    // chatStorage cursor the reconnect flow wrote before calling this.
    if (!options.afterSeq || options.afterSeq <= 0) {
      this.recentSeqByChat.delete(options.chatId);
    }
    this.registerAndReplay(options.chatId, options.messageId, options);
    return options.messageId;
  }
}

export const streamService = new StreamService();
