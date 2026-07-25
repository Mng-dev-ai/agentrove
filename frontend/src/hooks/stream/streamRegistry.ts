import { StreamContentBuffer } from '@/utils/stream';
import type { AssistantStreamEvent } from '@/types/chat.types';
import type { StreamEnvelope } from '@/types/stream.types';
import type { StreamSessionState } from '@/hooks/stream/messageUpdates';

// Module-level so chat-switch remounts don't destroy live stream state; these
// functions are the only writers, keeping a stream's buffer and session paired.
const streamBuffers = new Map<string, StreamContentBuffer>();
const streamSessions = new Map<string, StreamSessionState>();
const pendingStopEnvelopesByMessage = new Map<string, StreamEnvelope[]>();

export function getStreamSession(streamId: string | undefined): StreamSessionState | undefined {
  return streamId ? streamSessions.get(streamId) : undefined;
}

export function getStreamBuffer(streamId: string): StreamContentBuffer | undefined {
  return streamBuffers.get(streamId);
}

export function findStreamIdByMessage(messageId?: string): string | undefined {
  if (!messageId) return undefined;
  for (const [streamId, session] of streamSessions.entries()) {
    if (session.messageId === messageId) {
      return streamId;
    }
  }
  return undefined;
}

export function streamSessionsForChat(chatId: string): Array<[string, StreamSessionState]> {
  return Array.from(streamSessions.entries()).filter(([, session]) => session.chatId === chatId);
}

// Update-if-present; a missing buffer tells the caller to seed one.
export function advanceStreamSession(
  streamId: string,
  messageId: string,
  seq: number,
  chatId: string,
): StreamContentBuffer | undefined {
  const buffer = streamBuffers.get(streamId);
  const session = streamSessions.get(streamId);
  if (!buffer || !session) return undefined;
  session.lastSeq = Math.max(session.lastSeq, seq);
  session.messageId = messageId;
  session.chatId = chatId;
  return buffer;
}

export function createStreamSession(
  streamId: string,
  session: StreamSessionState,
  seedEvents: AssistantStreamEvent[],
  seedText: string,
): StreamContentBuffer {
  const buffer = new StreamContentBuffer(seedEvents, seedText);
  streamBuffers.set(streamId, buffer);
  streamSessions.set(streamId, session);
  return buffer;
}

export function stashPendingStopEnvelope(messageId: string, envelope: StreamEnvelope): void {
  const envelopes = pendingStopEnvelopesByMessage.get(messageId) ?? [];
  envelopes.push(envelope);
  pendingStopEnvelopesByMessage.set(messageId, envelopes);
}

export function takePendingStopEnvelopes(messageId: string): StreamEnvelope[] {
  const envelopes = pendingStopEnvelopesByMessage.get(messageId) ?? [];
  pendingStopEnvelopesByMessage.delete(messageId);
  return envelopes;
}

export function clearStreamSession(streamId: string | undefined): void {
  if (!streamId) return;
  streamBuffers.delete(streamId);
  streamSessions.delete(streamId);
}

export function clearAllStreamState(): void {
  streamBuffers.clear();
  streamSessions.clear();
  pendingStopEnvelopesByMessage.clear();
}
