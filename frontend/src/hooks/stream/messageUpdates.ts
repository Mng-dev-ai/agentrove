import { StreamContentBuffer } from '@/utils/stream';
import type { AssistantStreamEvent, Message } from '@/types/chat.types';
import { StreamProcessingError, type QueueProcessingData } from '@/types/stream.types';

export interface StreamSessionState {
  messageId: string;
  lastSeq: number;
  chatId: string;
  // Captured at session creation so an off-screen completion can invalidate the
  // right sandbox's caches — the user may be viewing a different chat by then.
  sandboxId: string | undefined;
}

export function createEmptyRenderSnapshot(): Message['content_render'] {
  return { events: [] };
}

export function getStreamErrorMessage(streamError: Error): string {
  if (streamError instanceof StreamProcessingError) {
    const originalMessage = streamError.originalError?.message;
    if (originalMessage?.trim()) return originalMessage;
  }
  return streamError.message || 'An error occurred';
}

export function buildFailedMessageUpdate(streamError: Error): (msg: Message) => Message {
  const errorMessage = getStreamErrorMessage(streamError);

  return (msg: Message): Message => {
    const existingEvents = Array.isArray(msg.content_render?.events)
      ? msg.content_render.events
      : [];
    const nextEvents: AssistantStreamEvent[] = [
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

export function buildContentFlushUpdate(
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
    content_render: { events: nextRender.events ?? [] },
    last_seq: nextSeq,
    active_stream_id: streamId,
  });
}

export function createTurnMessages(
  chatId: string,
  data: Pick<
    QueueProcessingData,
    'userMessageId' | 'assistantMessageId' | 'content' | 'modelId' | 'checkpointId' | 'attachments'
  >,
): Message[] {
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
    tool_results_omitted: false,
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
    tool_results_omitted: false,
  };

  return [userMessage, assistantMessage];
}

export function insertMessagesById(existing: Message[], incoming: Message[]): Message[] {
  let merged = existing;
  for (let index = incoming.length - 1; index >= 0; index--) {
    const message = incoming[index];
    if (merged.some((item) => item.id === message.id)) continue;
    const nextIndex = merged.findIndex((item) => item.id === incoming[index + 1]?.id);
    const insertIndex = nextIndex < 0 ? merged.length : nextIndex;
    merged = [...merged.slice(0, insertIndex), message, ...merged.slice(insertIndex)];
  }
  return merged;
}
