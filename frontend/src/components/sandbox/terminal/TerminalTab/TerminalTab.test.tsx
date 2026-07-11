// @vitest-environment jsdom

import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TerminalTab } from './TerminalTab';

const mocks = vi.hoisted(() => {
  const writeCallbacks: Array<() => void> = [];
  const terminal = {
    cols: 120,
    rows: 40,
    attachCustomKeyEventHandler: vi.fn(),
    focus: vi.fn(),
    refresh: vi.fn(),
    reset: vi.fn(),
    write: vi.fn((_data: string, callback?: () => void) => {
      if (callback) {
        writeCallbacks.push(callback);
      }
    }),
  };

  return {
    fitTerminal: vi.fn(() => ({ rows: terminal.rows, cols: terminal.cols })),
    getValidToken: vi.fn().mockResolvedValue('terminal-token'),
    terminal,
    terminalRef: { current: terminal },
    wrapperRef: { current: null },
    writeCallbacks,
  };
});

vi.mock('@/hooks/useResolvedTheme', () => ({
  useResolvedTheme: () => 'dark',
}));

vi.mock('@/store/uiStore', () => ({
  useUIStore: (selector: (state: { theme: 'dark' }) => unknown) => selector({ theme: 'dark' }),
}));

vi.mock('@/hooks/useXterm', () => ({
  useXterm: () => ({
    fitTerminal: mocks.fitTerminal,
    isReady: true,
    searchAddonRef: { current: null },
    terminalRef: mocks.terminalRef,
    wrapperRef: mocks.wrapperRef,
  }),
}));

vi.mock('@/lib/api', () => ({
  resolveSandboxClient: () => ({ getValidToken: mocks.getValidToken }),
  resolveSandboxWs: () => 'wss://sandbox.example.test',
}));

vi.mock('@/utils/logger', () => ({
  logger: { error: vi.fn() },
}));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;

  readyState = 0;
  send = vi.fn();
  private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch('open', new Event('open'));
  }

  message(data: Record<string, unknown>): void {
    this.dispatch('message', new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  sentMessages(): unknown[] {
    return this.send.mock.calls
      .filter(([payload]) => typeof payload === 'string')
      .map(([payload]) => JSON.parse(payload as string) as unknown);
  }

  private dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
  }
}

describe('TerminalTab restored output', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeCallbacks.length = 0;
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    // The real xterm is opened asynchronously, so the mount-time focus frame
    // runs before terminalRef is populated. Keep that frame pending here too.
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  it('requests a repaint after init, then focuses only after the first write is parsed', async () => {
    render(<TerminalTab isVisible sandboxId="sandbox-1" terminalId="terminal-1" />);

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const websocket = FakeWebSocket.instances[0];

    act(() => websocket.open());
    expect(mocks.terminal.focus).not.toHaveBeenCalled();
    // No repaint request until the server acks init — the session may not
    // even have a PTY yet.
    expect(websocket.sentMessages()).not.toContainEqual({ type: 'refresh' });

    act(() => websocket.message({ type: 'init', id: 'pty-1', rows: 40, cols: 120 }));
    expect(websocket.sentMessages()).toContainEqual({ type: 'refresh' });

    act(() => websocket.message({ type: 'stdout', data: '\u001b[?1004hrestored screen' }));
    expect(mocks.terminal.write).toHaveBeenCalledWith(
      '\u001b[?1004hrestored screen',
      expect.any(Function),
    );
    expect(mocks.terminal.refresh).not.toHaveBeenCalled();
    expect(mocks.terminal.focus).not.toHaveBeenCalled();

    act(() => mocks.writeCallbacks[0]());
    expect(mocks.terminal.refresh).toHaveBeenCalledWith(0, 39);
    expect(mocks.terminal.focus).toHaveBeenCalledOnce();

    act(() => websocket.message({ type: 'stdout', data: 'later output' }));
    expect(mocks.terminal.write).toHaveBeenLastCalledWith('later output', undefined);
    expect(mocks.terminal.focus).toHaveBeenCalledOnce();
  });
});
