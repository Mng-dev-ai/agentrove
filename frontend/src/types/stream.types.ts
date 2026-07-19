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
  | 'plan'
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
  // Handoff suppresses prior complete; duration rides here for "Worked for X".
  priorMessageId: string;
  priorDurationMs: number | null;
}

export interface ApiStreamResponse {
  messageId: string;
  checkpointId: string | null;
  // Set server-side on send when this turn binds a worktree (before stream events).
  worktreeCwd: string | null;
}

// Multiplexed via streamConnection + envelope.chatId (no per-stream socket).
export interface ActiveStream {
  id: string;
  chatId: string;
  messageId: string;
  startTime: number;
  isActive: boolean;
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

// GET /chat/chats/active-streams — one entry per running turn.
export interface ActiveStreamSnapshot {
  chat_id: string;
  message_id: string;
  stream_id: string | null;
  last_seq: number;
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
