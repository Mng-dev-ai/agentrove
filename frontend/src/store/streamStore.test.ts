import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useStreamStore } from './streamStore';
import type { ActiveStream } from '@/types/stream.types';

function makeStream(id: string, chatId: string, messageId: string, isActive = true): ActiveStream {
  return {
    id,
    chatId,
    messageId,
    startTime: 1000,
    isActive,
    callbacks: { onEnvelope: vi.fn() },
  };
}

beforeEach(() => {
  useStreamStore.setState({
    activeStreams: new Map(),
    streamIdByChatMessage: new Map(),
    activeStreamMetadata: [],
    completedChatIds: new Set(),
  });
});

describe('addStream', () => {
  it('indexes the stream by id and by chat/message, and records metadata', () => {
    const stream = makeStream('s1', 'c1', 'm1');
    useStreamStore.getState().addStream(stream);
    const state = useStreamStore.getState();
    expect(state.getStream('s1')).toBe(stream);
    expect(state.getStreamByChatAndMessage('c1', 'm1')).toBe(stream);
    expect(state.activeStreamMetadata).toEqual([
      { chatId: 'c1', messageId: 'm1', startTime: 1000 },
    ]);
  });

  it('keeps one metadata entry per chat, replacing on re-add', () => {
    useStreamStore.getState().addStream(makeStream('s1', 'c1', 'm1'));
    useStreamStore.getState().addStream(makeStream('s2', 'c1', 'm2'));
    const meta = useStreamStore.getState().activeStreamMetadata;
    expect(meta).toHaveLength(1);
    expect(meta[0].messageId).toBe('m2');
  });
});

describe('getStreamByChat', () => {
  it('returns the active stream for a chat', () => {
    const stream = makeStream('s1', 'c1', 'm1');
    useStreamStore.getState().addStream(stream);
    expect(useStreamStore.getState().getStreamByChat('c1')).toBe(stream);
  });

  it('ignores inactive streams', () => {
    useStreamStore.getState().addStream(makeStream('s1', 'c1', 'm1', false));
    expect(useStreamStore.getState().getStreamByChat('c1')).toBeUndefined();
  });

  it('returns the first active stream when several exist for the chat', () => {
    const inactive = makeStream('s1', 'c1', 'm1', false);
    const active = makeStream('s2', 'c1', 'm2');
    useStreamStore.getState().addStream(inactive);
    useStreamStore.getState().addStream(active);
    expect(useStreamStore.getState().getStreamByChat('c1')).toBe(active);
  });
});

describe('removeStream', () => {
  it('shuts down the stream and drops it from every index', () => {
    const stream = makeStream('s1', 'c1', 'm1');
    useStreamStore.getState().addStream(stream);
    useStreamStore.getState().removeStream('s1');

    const state = useStreamStore.getState();
    expect(state.getStream('s1')).toBeUndefined();
    expect(state.getStreamByChatAndMessage('c1', 'm1')).toBeUndefined();
    expect(state.activeStreamMetadata).toEqual([]);
    expect(stream.isActive).toBe(false);
    expect(stream.callbacks).toBeUndefined();
  });

  it('keeps chat metadata while another active stream remains for the chat', () => {
    useStreamStore.getState().addStream(makeStream('s1', 'c1', 'm1'));
    useStreamStore.getState().addStream(makeStream('s2', 'c1', 'm2'));
    useStreamStore.getState().removeStream('s2');
    // s1 is still active for c1, so its rollup metadata must survive.
    expect(useStreamStore.getState().activeStreamMetadata).toHaveLength(1);
  });

  it('drops chat metadata when the only remaining sibling stream is inactive', () => {
    useStreamStore.getState().addStream(makeStream('s1', 'c1', 'm1'));
    useStreamStore.getState().addStream(makeStream('s2', 'c1', 'm2', false));
    useStreamStore.getState().removeStream('s1');
    // Only an inactive stream is left, so the "running" rollup must clear.
    expect(useStreamStore.getState().activeStreamMetadata).toEqual([]);
  });

  it('is a no-op for an unknown stream id', () => {
    const before = useStreamStore.getState();
    useStreamStore.getState().removeStream('missing');
    expect(useStreamStore.getState()).toBe(before);
  });
});

describe('abortStream', () => {
  it('delegates to removeStream', () => {
    useStreamStore.getState().addStream(makeStream('s1', 'c1', 'm1'));
    useStreamStore.getState().abortStream('s1');
    expect(useStreamStore.getState().getStream('s1')).toBeUndefined();
  });
});

describe('completed chat tracking', () => {
  it('marks and clears completed chats', () => {
    useStreamStore.getState().markCompleted('c1');
    expect(useStreamStore.getState().completedChatIds.has('c1')).toBe(true);
    useStreamStore.getState().clearCompleted('c1');
    expect(useStreamStore.getState().completedChatIds.has('c1')).toBe(false);
  });

  it('returns the same state when clearing a chat that was not completed', () => {
    const before = useStreamStore.getState().completedChatIds;
    useStreamStore.getState().clearCompleted('c1');
    expect(useStreamStore.getState().completedChatIds).toBe(before);
  });
});

describe('updateStreamCallbacks', () => {
  it('replaces callbacks on an active stream', () => {
    const stream = makeStream('s1', 'c1', 'm1');
    useStreamStore.getState().addStream(stream);
    const callbacks = { onError: vi.fn() };
    useStreamStore.getState().updateStreamCallbacks('c1', 'm1', callbacks);
    expect(useStreamStore.getState().getStream('s1')?.callbacks).toBe(callbacks);
  });

  it('leaves callbacks untouched for an inactive stream', () => {
    const stream = makeStream('s1', 'c1', 'm1', false);
    const original = stream.callbacks;
    useStreamStore.getState().addStream(stream);
    useStreamStore.getState().updateStreamCallbacks('c1', 'm1', { onError: vi.fn() });
    expect(useStreamStore.getState().getStream('s1')?.callbacks).toBe(original);
  });
});

describe('updateStreamMessageId', () => {
  it('re-keys the stream, restarts the clock, and refreshes metadata', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:05Z'));
    const stream = makeStream('s1', 'c1', 'old');
    useStreamStore.getState().addStream(stream);

    useStreamStore.getState().updateStreamMessageId('c1', 'old', 'new');
    const state = useStreamStore.getState();
    const now = new Date('2020-01-01T00:00:05Z').getTime();

    expect(state.getStreamByChatAndMessage('c1', 'old')).toBeUndefined();
    const moved = state.getStreamByChatAndMessage('c1', 'new');
    expect(moved?.messageId).toBe('new');
    expect(moved?.startTime).toBe(now);
    expect(state.activeStreamMetadata).toEqual([
      { chatId: 'c1', messageId: 'new', startTime: now },
    ]);
    vi.useRealTimers();
  });

  it('is a no-op when the old message id is not tracked', () => {
    const before = useStreamStore.getState();
    useStreamStore.getState().updateStreamMessageId('c1', 'old', 'new');
    expect(useStreamStore.getState()).toBe(before);
  });
});

describe('removeStreamMetadata', () => {
  it('shuts down every stream for the chat and drops its metadata', () => {
    const s1 = makeStream('s1', 'c1', 'm1');
    const s2 = makeStream('s2', 'c1', 'm2');
    const other = makeStream('s3', 'c2', 'm3');
    useStreamStore.getState().addStream(s1);
    useStreamStore.getState().addStream(s2);
    useStreamStore.getState().addStream(other);

    useStreamStore.getState().removeStreamMetadata('c1');
    const state = useStreamStore.getState();
    expect(state.getStream('s1')).toBeUndefined();
    expect(state.getStream('s2')).toBeUndefined();
    expect(state.getStream('s3')).toBe(other);
    expect(state.activeStreamMetadata.map((m) => m.chatId)).toEqual(['c2']);
  });
});

describe('addStreamMetadata / addStreamMetadataIfAbsent', () => {
  it('upserts by chat id with addStreamMetadata', () => {
    useStreamStore.getState().addStreamMetadata({ chatId: 'c1', messageId: 'm1', startTime: 1 });
    useStreamStore.getState().addStreamMetadata({ chatId: 'c1', messageId: 'm2', startTime: 2 });
    const meta = useStreamStore.getState().activeStreamMetadata;
    expect(meta).toEqual([{ chatId: 'c1', messageId: 'm2', startTime: 2 }]);
  });

  it('keeps the existing entry with addStreamMetadataIfAbsent', () => {
    useStreamStore.getState().addStreamMetadata({ chatId: 'c1', messageId: 'm1', startTime: 1 });
    useStreamStore
      .getState()
      .addStreamMetadataIfAbsent({ chatId: 'c1', messageId: 'm2', startTime: 2 });
    // A live stream's startTime must not reset on restoration/event replay.
    expect(useStreamStore.getState().activeStreamMetadata).toEqual([
      { chatId: 'c1', messageId: 'm1', startTime: 1 },
    ]);
  });

  it('appends a new chat entry with addStreamMetadataIfAbsent', () => {
    useStreamStore
      .getState()
      .addStreamMetadataIfAbsent({ chatId: 'c1', messageId: 'm1', startTime: 1 });
    expect(useStreamStore.getState().activeStreamMetadata).toHaveLength(1);
  });
});
