import type { MessageAttachment } from './chat.types';

export type StreamState = 'idle' | 'loading' | 'streaming';
export type StreamKind =
  | 'stream_started'
  | 'assistant_text'
  | 'assistant_thinking'
  | 'tool_started'
  | 'tool_completed'
  | 'tool_failed'
  | 'system'
  | 'permission_request'
  | 'prompt_suggestions'
  | 'snapshot'
  | 'complete'
  | 'error'
  | 'cancelled'
  | 'queue_processing';

export interface StreamEnvelope {
  chatId: string;
  messageId: string;
  streamId: string;
  seq: number;
  kind: StreamKind;
  payload: Record<string, unknown>;
}

export interface QueueProcessingData {
  queuedMessageId: string;
  userMessageId: string;
  assistantMessageId: string;
  checkpointId: string | null;
  content: string;
  modelId: string;
  attachments?: MessageAttachment[];
}

export interface ApiStreamResponse {
  source: EventSource;
  messageId: string;
  checkpointId: string | null;
}

export interface ActiveStream {
  id: string;
  chatId: string;
  messageId: string;
  source: EventSource;
  startTime: number;
  isActive: boolean;
  listeners: Array<{ type: string; handler: EventListener }>;
  callbacks?: {
    onEnvelope?: (envelope: StreamEnvelope) => void;
    onComplete?: (
      messageId?: string,
      streamId?: string,
      terminalKind?: 'complete' | 'cancelled',
      durationMs?: number | null,
    ) => void;
    onError?: (error: Error, messageId?: string, streamId?: string) => void;
    onQueueProcess?: (data: QueueProcessingData) => void;
  };
}

export interface StreamMetadata {
  chatId: string;
  messageId: string;
  startTime: number;
}

export class StreamProcessingError extends Error {
  constructor(
    message: string,
    public readonly originalError?: Error,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'StreamProcessingError';
    Object.setPrototypeOf(this, StreamProcessingError.prototype);
  }

  getDetailedMessage(): string {
    if (!this.originalError) return this.message;

    if (this.originalError instanceof Error) {
      return `${this.message}: ${this.originalError.message}`;
    }

    return `${this.message}: ${String(this.originalError)}`;
  }
}
