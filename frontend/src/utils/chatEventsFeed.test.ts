import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribeChatEventsFeed } from './chatEventsFeed';

vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn() } }));

class FakeEventSource {
  static readonly CLOSED = 2;
  readyState = 1;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, (event: Event) => void>();

  addEventListener(name: string, listener: (event: Event) => void) {
    this.listeners.set(name, listener);
  }

  close() {
    this.closed = true;
  }

  emit(name: string, data: string) {
    this.listeners.get(name)?.({ data } as MessageEvent);
  }

  fail(fatal: boolean) {
    if (fatal) this.readyState = FakeEventSource.CLOSED;
    this.onerror?.();
  }
}

const REOPEN_DELAY_MS = 15_000;

let sources: FakeEventSource[];
let createSource: ReturnType<typeof vi.fn<() => Promise<EventSource>>>;
const onChatEvent = vi.fn();
const onResync = vi.fn();

const subscribe = () =>
  subscribeChatEventsFeed({ createSource, onChatEvent, onResync, logContext: 'test' });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('EventSource', FakeEventSource);
  onChatEvent.mockReset();
  onResync.mockReset();
  sources = [];
  createSource = vi.fn(async () => {
    const source = new FakeEventSource();
    sources.push(source);
    return source as unknown as EventSource;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('subscribeChatEventsFeed', () => {
  it('forwards chat events without resyncing on the initial open', async () => {
    subscribe();
    await vi.advanceTimersByTimeAsync(0);

    sources[0].onopen?.();
    sources[0].emit('chat_event', '{"kind":"title_updated"}');

    expect(onChatEvent).toHaveBeenCalledWith(
      expect.objectContaining({ data: '{"kind":"title_updated"}' }),
    );
    expect(onResync).not.toHaveBeenCalled();
  });

  it('resyncs once after a transient drop without opening a new source', async () => {
    subscribe();
    await vi.advanceTimersByTimeAsync(0);

    sources[0].fail(false);
    await vi.advanceTimersByTimeAsync(REOPEN_DELAY_MS);
    expect(createSource).toHaveBeenCalledTimes(1);

    sources[0].onopen?.();
    sources[0].onopen?.();
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it('reopens a fatally closed feed after the delay and resyncs when it opens', async () => {
    subscribe();
    await vi.advanceTimersByTimeAsync(0);

    sources[0].fail(true);
    await vi.advanceTimersByTimeAsync(REOPEN_DELAY_MS - 1);
    expect(createSource).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(createSource).toHaveBeenCalledTimes(2);

    sources[1].onopen?.();
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it('retries a failed open and stops retrying once unsubscribed', async () => {
    createSource.mockRejectedValueOnce(new Error('token refresh failed'));
    const unsubscribe = subscribe();
    await vi.advanceTimersByTimeAsync(REOPEN_DELAY_MS);
    expect(createSource).toHaveBeenCalledTimes(2);

    sources[0].onopen?.();
    expect(onResync).toHaveBeenCalledTimes(1);

    sources[0].fail(true);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(REOPEN_DELAY_MS * 2);
    expect(createSource).toHaveBeenCalledTimes(2);
    expect(sources[0].closed).toBe(true);
  });

  it('closes a source that finishes opening after unsubscribe', async () => {
    let resolveSource!: (source: EventSource) => void;
    createSource.mockReturnValueOnce(new Promise((resolve) => (resolveSource = resolve)));
    const unsubscribe = subscribe();

    unsubscribe();
    const late = new FakeEventSource();
    resolveSource(late as unknown as EventSource);
    await vi.advanceTimersByTimeAsync(0);

    expect(late.closed).toBe(true);
  });
});
