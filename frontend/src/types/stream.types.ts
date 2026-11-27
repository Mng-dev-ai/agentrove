import type {
  ContextUsage,
  ElicitationSchema,
  Message,
  MessageAttachment,
  PermissionOption,
  PlanEntry,
} from './chat.types';
import type { ToolEventPayload } from './tools.types';

export type StreamState = 'idle' | 'loading' | 'streaming';

interface StreamEnvelopeBase<K extends string, P> {
  chatId: string;
  messageId: string;
  streamId: string;
  seq: number;
  kind: K;
  payload: P;
}

// `system` has two wire shapes. ACP session info and the turn's worktree nest
// under `data`; context usage or a rate-limits change sits at the top level beside `chat_id`. Nested
// `data.chat_id` / `data.context_usage` are tolerated legacy input that no
// current backend emits.
interface SystemDataPayload {
  data: {
    session_id?: string;
    worktree_cwd?: string;
    chat_id?: string;
    context_usage?: ContextUsage;
  };
  chat_id?: undefined;
  context_usage?: undefined;
  rate_limits_changed?: undefined;
}

interface SystemContextUsagePayload {
  context_usage: ContextUsage;
  chat_id: string;
  data?: undefined;
  rate_limits_changed?: undefined;
}

interface SystemRateLimitsPayload {
  rate_limits_changed: true;
  chat_id: string;
  data?: undefined;
  context_usage?: undefined;
}

interface RequestIdPayload {
  request_id: string;
}

interface TerminalPayload {
  status: NonNullable<Message['stream_status']>;
  duration_ms: number | null;
}

// Mirrors StreamEnvelopeKind in backend/app/services/streaming/types.py;
// frontend/src/test/streamEnvelopes.json holds both sides to the same shapes.
export type StreamEnvelope =
  | StreamEnvelopeBase<'stream_started', { status: 'started'; message_id: string }>
  | StreamEnvelopeBase<'assistant_text' | 'user_text', { text: string }>
  | StreamEnvelopeBase<'assistant_thinking', { thinking: string }>
  | StreamEnvelopeBase<
      'tool_started' | 'tool_completed' | 'tool_failed',
      { tool: ToolEventPayload }
    >
  | StreamEnvelopeBase<
      'user_steering',
      {
        queued_message_id: string;
        text: string;
        attachments: MessageAttachment[];
        app_notice?: boolean;
      }
    >
  | StreamEnvelopeBase<
      'system',
      SystemDataPayload | SystemContextUsagePayload | SystemRateLimitsPayload
    >
  | StreamEnvelopeBase<
      'permission_request',
      RequestIdPayload & {
        tool_name: string;
        tool_input: Record<string, unknown>;
        data: { options: PermissionOption[] };
      }
    >
  | StreamEnvelopeBase<
      | 'permission_resolved'
      | 'permission_dismissed'
      | 'elicitation_resolved'
      | 'elicitation_dismissed',
      RequestIdPayload
    >
  | StreamEnvelopeBase<
      'elicitation_request',
      RequestIdPayload & {
        data: {
          message: string;
          tool_call_id: string | null;
          requested_schema: ElicitationSchema;
        };
      }
    >
  | StreamEnvelopeBase<'prompt_suggestions', { suggestions: string[] }>
  | StreamEnvelopeBase<'plan', { data: { entries: PlanEntry[] } }>
  | StreamEnvelopeBase<'complete' | 'cancelled', TerminalPayload>
  | StreamEnvelopeBase<'error', { error: string }>
  | StreamEnvelopeBase<
      'queue_processing',
      {
        queued_message_id: string;
        user_message_id: string;
        assistant_message_id: string;
        checkpoint_id: string | null;
        content: string;
        model_id: string;
        attachments: MessageAttachment[] | null;
        prior_duration_ms: number | null;
      }
    >;

export interface QueueProcessingData {
  queuedMessageId: string;
  userMessageId: string;
  assistantMessageId: string;
  checkpointId: string | null;
  content: string;
  modelId: string;
  attachments: MessageAttachment[] | null;
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
