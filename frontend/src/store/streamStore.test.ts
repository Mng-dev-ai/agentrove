import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

const state = () => useStreamStore.getState();

beforeEach(() => {
  useStreamStore.setState({
    activeStreams: new Map(),
    streamIdByChatMessage: new Map(),
    activeStreamMetadata: [],
    lastToolTitleByChatId: new Map(),
    completedChatIds: new Set(),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('addStream', () => {
  it('indexes the stream by id and by chat/message, and records metadata', () => {
    const stream = makeStream('s1', 'c1', 'm1');
    state().addStream(stream);
    expect(state().getStream('s1')).toBe(stream);
    expect(state().getStreamByChatAndMessage('c1', 'm1')).toBe(stream);
    expect(state().activeStreamMetadata).toEqual([
      { chatId: 'c1', messageId: 'm1', startTime: 1000 },
    ]);
  });

  it('keeps one metadata entry per chat, replacing on re-add', () => {
    state().addStream(makeStream('s1', 'c1', 'm1'));
    state().addStream(makeStream('s2', 'c1', 'm2'));
    expect(state().activeStreamMetadata).toEqual([
      { chatId: 'c1', messageId: 'm2', startTime: 1000 },
    ]);
  });
});

describe('getStreamByChat', () => {
  it('ignores inactive streams', () => {
    state().addStream(makeStream('s1', 'c1', 'm1', false));
    expect(state().getStreamByChat('c1')).toBeUndefined();
  });

  it('returns the active stream when an inactive one exists for the same chat', () => {
    const active = makeStream('s2', 'c1', 'm2');
    state().addStream(makeStream('s1', 'c1', 'm1', false));
    state().addStream(active);
    expect(state().getStreamByChat('c1')).toBe(active);
  });
});

describe('removeStream', () => {
  it('shuts down the stream and drops it from every index', () => {
    const stream = makeStream('s1', 'c1', 'm1');
    state().addStream(stream);
    state().setLastToolTitle('c1', 'Reading');
    state().removeStream('s1');

    expect(state().getStream('s1')).toBeUndefined();
    expect(state().getStreamByChatAndMessage('c1', 'm1')).toBeUndefined();
    expect(state().activeStreamMetadata).toEqual([]);
    expect(state().lastToolTitleByChatId.has('c1')).toBe(false);
    expect(stream.isActive).toBe(false);
    expect(stream.callbacks).toBeUndefined();
  });

  it('keeps chat metadata and tool title while another active stream remains for the chat', () => {
    state().addStream(makeStream('s1', 'c1', 'm1'));
    state().addStream(makeStream('s2', 'c1', 'm2'));
    state().setLastToolTitle('c1', 'Reading');
    state().removeStream('s2');
    expect(state().activeStreamMetadata).toHaveLength(1);
    expect(state().lastToolTitleByChatId.get('c1')).toBe('Reading');
  });

  it('drops chat metadata when the only remaining sibling stream is inactive', () => {
    state().addStream(makeStream('s1', 'c1', 'm1'));
    state().addStream(makeStream('s2', 'c1', 'm2', false));
    state().removeStream('s1');
    expect(state().activeStreamMetadata).toEqual([]);
  });

  it('is a no-op for an unknown stream id', () => {
    const before = state();
    state().removeStream('missing');
    expect(state()).toBe(before);
  });
});

describe('completed chat tracking', () => {
  it('clears a completed chat and keeps the set reference when clearing again', () => {
    state().markCompleted('c1');
    state().clearCompleted('c1');
    expect(state().completedChatIds.has('c1')).toBe(false);

    const before = state().completedChatIds;
    state().clearCompleted('c1');
    expect(state().completedChatIds).toBe(before);
  });
});

describe('updateStreamCallbacks', () => {
  it('replaces callbacks on an active stream', () => {
    state().addStream(makeStream('s1', 'c1', 'm1'));
    const callbacks = { onError: vi.fn() };
    state().updateStreamCallbacks('c1', 'm1', callbacks);
    expect(state().getStream('s1')?.callbacks).toBe(callbacks);
  });

  it('leaves callbacks untouched for an inactive stream', () => {
    const stream = makeStream('s1', 'c1', 'm1', false);
    const original = stream.callbacks;
    state().addStream(stream);
    state().updateStreamCallbacks('c1', 'm1', { onError: vi.fn() });
    expect(state().getStream('s1')?.callbacks).toBe(original);
  });
});

describe('updateStreamMessageId', () => {
  it('re-keys the stream, restarts the clock, and drops the previous turn tool title', () => {
    vi.useFakeTimers();
    const now = new Date('2020-01-01T00:00:05Z').getTime();
    vi.setSystemTime(now);
    state().addStream(makeStream('s1', 'c1', 'old'));
    state().setLastToolTitle('c1', 'Reading');

    state().updateStreamMessageId('c1', 'old', 'new');

    expect(state().getStreamByChatAndMessage('c1', 'old')).toBeUndefined();
    expect(state().getStreamByChatAndMessage('c1', 'new')).toMatchObject({
      messageId: 'new',
      startTime: now,
    });
    expect(state().activeStreamMetadata).toEqual([
      { chatId: 'c1', messageId: 'new', startTime: now },
    ]);
    expect(state().lastToolTitleByChatId.has('c1')).toBe(false);
  });

  it('is a no-op when the old message id is not tracked', () => {
    const before = state();
    state().updateStreamMessageId('c1', 'old', 'new');
    expect(state()).toBe(before);
  });
});

describe('removeStreamMetadata', () => {
  it('shuts down every stream for the chat and leaves other chats alone', () => {
    const other = makeStream('s3', 'c2', 'm3');
    state().addStream(makeStream('s1', 'c1', 'm1'));
    state().addStream(makeStream('s2', 'c1', 'm2'));
    state().addStream(other);
    state().setLastToolTitle('c1', 'Reading');
    state().setLastToolTitle('c2', 'Writing');

    state().removeStreamMetadata('c1');

    expect(state().getStream('s1')).toBeUndefined();
    expect(state().getStream('s2')).toBeUndefined();
    expect(state().getStream('s3')).toBe(other);
    expect(state().activeStreamMetadata.map((m) => m.chatId)).toEqual(['c2']);
    expect(state().lastToolTitleByChatId.has('c1')).toBe(false);
    expect(state().lastToolTitleByChatId.get('c2')).toBe('Writing');
  });
});

describe('addStreamMetadata / addStreamMetadataIfAbsent', () => {
  it('upserts by chat id with addStreamMetadata', () => {
    state().addStreamMetadata({ chatId: 'c1', messageId: 'm1', startTime: 1 });
    state().addStreamMetadata({ chatId: 'c1', messageId: 'm2', startTime: 2 });
    expect(state().activeStreamMetadata).toEqual([{ chatId: 'c1', messageId: 'm2', startTime: 2 }]);
  });

  it('keeps an existing entry so a live startTime is not reset on replay', () => {
    state().addStreamMetadata({ chatId: 'c1', messageId: 'm1', startTime: 1 });
    state().addStreamMetadataIfAbsent({ chatId: 'c1', messageId: 'm2', startTime: 2 });
    state().addStreamMetadataIfAbsent({ chatId: 'c2', messageId: 'm3', startTime: 3 });
    expect(state().activeStreamMetadata).toEqual([
      { chatId: 'c1', messageId: 'm1', startTime: 1 },
      { chatId: 'c2', messageId: 'm3', startTime: 3 },
    ]);
  });
});
