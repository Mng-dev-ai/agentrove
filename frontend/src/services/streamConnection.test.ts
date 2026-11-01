// @vitest-environment jsdom

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { apiClient } from '@/lib/api';
import { useStreamStore } from '@/store/streamStore';
import { chatStorage } from '@/utils/storage';
import { streamConnection } from './streamConnection';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, (event: Event) => void>();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, listener);
  }

  emit(type: string, data?: string) {
    this.listeners.get(type)?.(new MessageEvent(type, { data }));
  }

  close() {
    this.closed = true;
  }

  get cursors(): Record<string, number> {
    return JSON.parse(new URL(this.url).searchParams.get('cursors') ?? '{}');
  }
}

const handlers = {
  onOpen: vi.fn(),
  onEnvelopeData: vi.fn(),
  onConnectionFailure: vi.fn(),
};

const sources = () => FakeEventSource.instances;
const latest = () => sources()[sources().length - 1];
const settle = () => vi.advanceTimersByTimeAsync(0);

function startStream(chatId: string, id = `s-${chatId}`) {
  useStreamStore.getState().addStream({
    id,
    chatId,
    messageId: `m-${chatId}`,
    startTime: 0,
    isActive: true,
  });
}

beforeAll(() => {
  streamConnection.configure(handlers);
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.clearAllMocks();
  vi.spyOn(apiClient, 'getValidToken').mockResolvedValue('tok');
  FakeEventSource.instances = [];
  localStorage.clear();
});

afterEach(() => {
  for (const id of [...useStreamStore.getState().activeStreams.keys()]) {
    useStreamStore.getState().removeStream(id);
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('streamConnection', () => {
  it('opens one feed with stored resume cursors and closes it when the last stream ends', async () => {
    chatStorage.setEventId('c1', '17');
    startStream('c1');
    await settle();

    expect(sources()).toHaveLength(1);
    expect(latest().cursors).toEqual({ c1: 17 });

    latest().emit('stream', '{"seq":18}');
    expect(handlers.onEnvelopeData).toHaveBeenCalledWith('{"seq":18}');

    useStreamStore.getState().removeStream('s-c1');
    expect(latest().closed).toBe(true);
  });

  it('reopens with fresh cursors only when a chat is missing from the replay set', async () => {
    startStream('c1');
    await settle();
    startStream('c2');
    await settle();
    expect(sources()).toHaveLength(1);

    streamConnection.requestReplay('c2');
    await settle();
    expect(sources()).toHaveLength(2);
    expect(sources()[0].closed).toBe(true);
    expect(latest().cursors).toEqual({ c1: 0, c2: 0 });

    streamConnection.requestReplay('c2');
    await settle();
    expect(sources()).toHaveLength(2);
  });

  it('backs off exponentially on errors and fails the affected chats after the retry budget', async () => {
    startStream('c1');
    await settle();

    const delays = [1000, 2000, 4000, 8000, 15000];
    for (const delay of delays) {
      chatStorage.setEventId('c1', '5');
      latest().onerror?.();
      await vi.advanceTimersByTimeAsync(delay - 1);
      const countBefore = sources().length;
      await vi.advanceTimersByTimeAsync(1);
      expect(sources()).toHaveLength(countBefore + 1);
      expect(latest().cursors).toEqual({ c1: 5 });
    }

    latest().onerror?.();
    expect(handlers.onConnectionFailure).toHaveBeenCalledWith(['c1']);
    await vi.advanceTimersByTimeAsync(60000);
    expect(sources()).toHaveLength(delays.length + 1);
  });

  it('resets the retry budget once a connection has stayed open', async () => {
    startStream('c1');
    await settle();

    for (let i = 0; i < 5; i++) {
      latest().onerror?.();
      await vi.advanceTimersByTimeAsync(15000);
    }
    latest().onopen?.();
    expect(handlers.onOpen).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15000);

    latest().onerror?.();
    expect(handlers.onConnectionFailure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sources()).toHaveLength(7);
  });

  it('fails the chats without opening a feed when no token can be minted', async () => {
    vi.mocked(apiClient.getValidToken).mockResolvedValue(null);
    startStream('c1');
    await settle();

    expect(sources()).toHaveLength(0);
    expect(handlers.onConnectionFailure).toHaveBeenCalledWith(['c1']);
  });

  it('reopens a silent half-open feed but keeps one that receives pings', async () => {
    startStream('c1');
    await settle();

    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(15000);
      latest().emit('ping');
    }
    expect(sources()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60000);
    expect(sources()).toHaveLength(2);
    expect(sources()[0].closed).toBe(true);
  });
});
