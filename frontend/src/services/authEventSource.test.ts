import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthEventSource } from './authEventSource';

const encoder = new TextEncoder();

function streamResponse(chunks: string[], keepOpen = false): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (!keepOpen) controller.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

function stubClient(...responses: Response[]) {
  const signals: AbortSignal[] = [];
  const openStream = vi.fn(async (_endpoint: string, signal: AbortSignal) => {
    signals.push(signal);
    return responses.shift() ?? streamResponse([], true);
  });
  return { client: { openStream }, openStream, signals };
}

function collect(source: AuthEventSource, ...types: string[]) {
  const received: { type: string; data: string }[] = [];
  for (const type of types) {
    source.addEventListener(type, (event: Event) =>
      received.push({ type, data: (event as MessageEvent).data }),
    );
  }
  return received;
}

async function until(condition: () => boolean) {
  while (!condition()) await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AuthEventSource', () => {
  it('parses named and multi-line events with CRLF split across chunks', async () => {
    const { client } = stubClient(
      streamResponse(
        [': ping\r\nevent: stream\r\ndata: first\r', '\ndata: second\r\n\r', '\ndata: plain\n\n'],
        true,
      ),
    );
    const source = new AuthEventSource(client, '/events');
    const received = collect(source, 'stream', 'message');

    await until(() => received.length === 2);

    expect(received).toEqual([
      { type: 'stream', data: 'first\nsecond' },
      { type: 'message', data: 'plain' },
    ]);
    expect(source.readyState).toBe(AuthEventSource.OPEN);
    source.close();
  });

  it('reconnects after the stream ends using the server retry delay', async () => {
    const { client, openStream } = stubClient(
      streamResponse(['retry: 500\n\n']),
      streamResponse(['data: resumed\n\n'], true),
    );
    const source = new AuthEventSource(client, '/events');
    const errorStates: number[] = [];
    source.onerror = () => errorStates.push(source.readyState);
    const received = collect(source, 'message');

    await until(() => errorStates.length === 1);
    expect(errorStates).toEqual([AuthEventSource.CONNECTING]);
    await vi.advanceTimersByTimeAsync(499);
    expect(openStream).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await until(() => received.length === 1);
    expect(received).toEqual([{ type: 'message', data: 'resumed' }]);
    expect(openStream).toHaveBeenCalledTimes(2);
    source.close();
  });

  it('closes without reconnecting on a non-200 response', async () => {
    const { client, openStream } = stubClient(new Response('denied', { status: 401 }));
    const source = new AuthEventSource(client, '/events');
    const errorStates: number[] = [];
    source.onerror = () => errorStates.push(source.readyState);

    await until(() => errorStates.length === 1);
    expect(errorStates).toEqual([AuthEventSource.CLOSED]);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(openStream).toHaveBeenCalledTimes(1);
  });

  it('aborts the request on close and stops reconnecting', async () => {
    const { client, openStream, signals } = stubClient(streamResponse(['data: open\n\n'], true));
    const source = new AuthEventSource(client, '/events');
    const onerror = vi.fn();
    source.onerror = onerror;
    const received = collect(source, 'message');
    await until(() => received.length === 1);

    source.close();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(signals[0].aborted).toBe(true);
    expect(source.readyState).toBe(AuthEventSource.CLOSED);
    expect(onerror).not.toHaveBeenCalled();
    expect(openStream).toHaveBeenCalledTimes(1);
  });
});
