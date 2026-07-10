import { StreamContentBuffer } from '@/utils/stream';
import type { AssistantStreamEvent, Message } from '@/types/chat.types';
import { StreamProcessingError } from '@/types/stream.types';

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
