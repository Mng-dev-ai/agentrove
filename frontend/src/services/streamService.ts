import { useStreamStore } from '@/store/streamStore';
import { useMessageQueueStore } from '@/store/messageQueueStore';
import type { ChatRequest } from '@/types/chat.types';
import type {
  ActiveStream,
  ApiStreamResponse,
  QueueProcessingData,
  StreamEnvelope,
} from '@/types/stream.types';
import { StreamProcessingError } from '@/types/stream.types';
import { chatService } from '@/services/chatService';
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
      });
    }
  }

  private handleStreamEnvelope(event: MessageEvent, streamId: string, chatId: string): void {
    if (!event.data) return;

    const currentStream = useStreamStore.getState().getStream(streamId);
    if (!currentStream) return;

    const parsed = this.parseStreamEvent<StreamEnvelope>(event.data);
    if (!parsed) return;

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

    // Queue handoff events carry the old assistant message ID but must be processed
    // before the messageId filter — they update the stream's messageId for subsequent events.
    if (parsed.kind === 'queue_processing') {
      this.maybeHandleQueueEvent(parsed, chatId);
    }

    const isForActiveMessage = parsed.messageId === currentStream.messageId;
    if (!isForActiveMessage) {
      return;
    }

    currentStream.callbacks?.onEnvelope?.(parsed);

    if (parsed.kind === 'complete' || parsed.kind === 'cancelled') {
      const { callbacks } = currentStream;
      const durationMs =
        typeof parsed.payload?.duration_ms === 'number' ? parsed.payload.duration_ms : null;
      useStreamStore.getState().removeStream(streamId);
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

  private handleGenericError(event: Event | ErrorEvent, streamId: string, messageId: string): void {
    const currentStream = useStreamStore.getState().getStream(streamId);
    if (!currentStream) return;

    // EventSource emits transport "error" while reconnecting; do not fail fast.
    if (currentStream.source.readyState === EventSource.CONNECTING) {
      return;
    }

    currentStream.source.close();

    const error =
      event instanceof ErrorEvent && event.error instanceof Error
        ? event.error
        : new Error('Stream connection error');

    const wrappedError = new StreamProcessingError('Stream connection error', error);
    this.cleanupStream(streamId, wrappedError, messageId);
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

  private attachStreamHandlers(streamId: string, messageId: string): void {
    const activeStream = useStreamStore.getState().getStream(streamId);
    if (!activeStream) return;

    const { source, chatId } = activeStream;

    const register = (type: string, handler: EventListener) => {
      source.addEventListener(type, handler);
      activeStream.listeners.push({ type, handler });
    };

    register('stream', (event: Event) =>
      this.handleStreamEnvelope(event as MessageEvent, streamId, chatId),
    );

    source.onerror = (event) => {
      this.handleGenericError(event, streamId, messageId);
    };
  }

  async startStream(
    options: StreamOptions,
  ): Promise<Pick<ApiStreamResponse, 'messageId' | 'checkpointId'>> {
    const streamId = crypto.randomUUID();

    try {
      const { source, messageId, checkpointId } = await chatService.createCompletion(
        options.request,
        options.signal,
      );

      const activeStream: ActiveStream = {
        id: streamId,
        chatId: options.chatId,
        messageId,
        source,
        startTime: Date.now(),
        isActive: true,
        listeners: [],
        callbacks: {
          onEnvelope: options.onEnvelope,
          onComplete: options.onComplete,
          onError: options.onError,
          onQueueProcess: options.onQueueProcess,
        },
      };

      useStreamStore.getState().addStream(activeStream);
      this.attachStreamHandlers(streamId, messageId);

      return { messageId, checkpointId };
    } catch (error) {
      useStreamStore.getState().removeStream(streamId);
      throw error;
    }
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

  async reconnectToStream(options: StreamReconnectOptions): Promise<string> {
    const streamId = crypto.randomUUID();

    try {
      const { source } = await chatService.reconnectToStream(
        options.chatId,
        options.messageId,
        undefined,
        options.afterSeq,
      );

      const activeStream: ActiveStream = {
        id: streamId,
        chatId: options.chatId,
        messageId: options.messageId,
        source,
        startTime: Date.now(),
        isActive: true,
        listeners: [],
        callbacks: {
          onEnvelope: options.onEnvelope,
          onComplete: options.onComplete,
          onError: options.onError,
          onQueueProcess: options.onQueueProcess,
        },
      };

      useStreamStore.getState().addStream(activeStream);

      this.attachStreamHandlers(streamId, options.messageId);

      return options.messageId;
    } catch (error) {
      useStreamStore.getState().removeStream(streamId);
      throw error;
    }
  }

  async replayStream(options: StreamReconnectOptions): Promise<string> {
    if (!options.afterSeq || options.afterSeq <= 0) {
      this.recentSeqByChat.delete(options.chatId);
    }
    return this.reconnectToStream(options);
  }
}

export const streamService = new StreamService();
