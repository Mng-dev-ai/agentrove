// @vitest-environment jsdom

import { useRef, useState, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import toast from 'react-hot-toast';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { queryKeys } from '@/hooks/queries/queryKeys';
import { clearAllStreamState } from '@/hooks/stream/streamRegistry';
import { chatService } from '@/services/chatService';
import { useChatSettingsStore } from '@/store/chatSettingsStore';
import type { Chat, Message } from '@/types/chat.types';
import type { QueueProcessingData, StreamEnvelope, StreamKind } from '@/types/stream.types';
import { makeMessage, readMessagePages, seedMessagePages } from '@/test/fixtures';
import { useStreamCallbacks } from './useStreamCallbacks';

function envelope(
  kind: StreamKind,
  payload: Record<string, unknown>,
  overrides: Partial<StreamEnvelope> = {},
): StreamEnvelope {
  return { chatId: 'c1', messageId: 'a1', streamId: 's1', seq: 1, kind, payload, ...overrides };
}

const text = (value: string, overrides?: Partial<StreamEnvelope>) =>
  envelope('assistant_text', { text: value }, overrides);

const handlers = {
  onPermissionRequest: vi.fn(),
  onElicitationRequest: vi.fn(),
  onElicitationDismissed: vi.fn(),
  onContextUsageUpdate: vi.fn(),
};

let queryClient: QueryClient;

const seedCache = (chatId: string, newestFirst: Message[]) =>
  seedMessagePages(queryClient, chatId, [newestFirst]);

const cachedMessage = (chatId: string, id: string) =>
  readMessagePages(queryClient, chatId)?.[0].find((m) => m.id === id);

function renderCallbacks(initialMessages: Message[] = [makeMessage('a1')]) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return renderHook(
    () => {
      const [messages, setMessages] = useState(initialMessages);
      const [streamState, setStreamState] = useState<'idle' | 'loading' | 'streaming'>('streaming');
      const [currentMessageId, setCurrentMessageId] = useState<string | null>('a1');
      const pendingStopRef = useRef(new Set<string>());
      const callbacks = useStreamCallbacks({
        messages,
        chatId: 'c1',
        currentChat: { id: 'c1', sandbox_id: 'sb1', parent_chat_id: null } as Chat,
        queryClient,
        setMessages,
        setStreamState,
        setCurrentMessageId,
        pendingStopRef,
        ...handlers,
      });
      return { ...callbacks, messages, streamState, currentMessageId, pendingStopRef };
    },
    { wrapper },
  );
}

const flushTimers = () => act(() => vi.advanceTimersByTime(50));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  clearAllStreamState();
  queryClient = new QueryClient();
  queryClient.setQueryData([queryKeys.settings], { notifications_enabled: false });
  seedCache('c1', [makeMessage('a1')]);
  vi.spyOn(chatService, 'markChatViewed').mockResolvedValue();
  useChatSettingsStore.setState({ permissionModeByChat: {} });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('content envelopes', () => {
  it('coalesces deltas into one flush to live messages and cache, keeping the highest seq', async () => {
    const { result } = renderCallbacks();

    act(() => {
      result.current.onEnvelope(text('Hel', { seq: 3 }));
      result.current.onEnvelope(text('lo', { seq: 2 }));
    });
    expect(result.current.messages[0].content_text).toBe('');

    await flushTimers();

    const expected = {
      content_text: 'Hello',
      content_render: { events: [{ type: 'assistant_text', text: 'Hello' }] },
      last_seq: 3,
      active_stream_id: 's1',
    };
    expect(result.current.messages[0]).toMatchObject(expected);
    expect(cachedMessage('c1', 'a1')).toMatchObject(expected);
  });

  it('appends an off-screen chat stream onto its cached content without touching the open chat', async () => {
    seedCache('c2', [
      makeMessage('b1', {
        chat_id: 'c2',
        content_text: 'Earlier ',
        content_render: { events: [{ type: 'assistant_text', text: 'Earlier ' }] },
      }),
    ]);
    const { result } = renderCallbacks();

    act(() => result.current.onEnvelope(text('text', { chatId: 'c2', messageId: 'b1' })));
    await flushTimers();

    expect(cachedMessage('c2', 'b1')?.content_text).toBe('Earlier text');
    expect(result.current.messages).toEqual([makeMessage('a1')]);
  });

  it('persists the buffered tail to the cache when the pane unmounts', () => {
    const { result, unmount } = renderCallbacks();

    act(() => result.current.onEnvelope(text('tail')));
    unmount();

    expect(cachedMessage('c1', 'a1')?.content_text).toBe('tail');
  });
});

describe('side-effect envelopes', () => {
  it('routes well-formed permission and elicitation requests to their handlers, not message content', async () => {
    const { result } = renderCallbacks();

    act(() => {
      result.current.onEnvelope(
        envelope(
          'permission_request',
          {
            request_id: 'p1',
            tool_name: 'Bash',
            tool_input: { command: 'ls' },
            data: { options: [{ id: 'allow' }] },
          },
          { seq: 7 },
        ),
      );
      result.current.onEnvelope(
        envelope('permission_request', { request_id: 'p2', tool_name: 'Bash' }),
      );
      result.current.onEnvelope(
        envelope('elicitation_request', { request_id: 'e1', data: { message: 'Pick one' } }),
      );
      result.current.onEnvelope(envelope('elicitation_dismissed', { request_id: 'e0' }));
    });
    await flushTimers();

    expect(handlers.onPermissionRequest).toHaveBeenCalledTimes(1);
    expect(handlers.onPermissionRequest).toHaveBeenCalledWith({
      request_id: 'p1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      options: [{ id: 'allow' }],
      seq: 7,
    });
    expect(handlers.onElicitationRequest).toHaveBeenCalledWith({
      request_id: 'e1',
      message: 'Pick one',
      tool_call_id: null,
      requested_schema: {},
    });
    expect(handlers.onElicitationDismissed).toHaveBeenCalledWith('e0');
    expect(result.current.messages[0].content_render.events).toEqual([]);
  });

  it('applies context usage and worktree updates from system envelopes', () => {
    queryClient.setQueryData(queryKeys.chat('c1'), { id: 'c1', worktree_cwd: null } as Chat);
    const usage = { tokens_used: 10, context_window: 100, percentage: 10 };
    const { result } = renderCallbacks();

    act(() =>
      result.current.onEnvelope(
        envelope('system', {
          data: { chat_id: 'c1', context_usage: usage, worktree_cwd: '/wt/feature' },
        }),
      ),
    );

    expect(handlers.onContextUsageUpdate).toHaveBeenCalledWith(usage, 'c1');
    expect(queryClient.getQueryData<Chat>(queryKeys.chat('c1'))?.worktree_cwd).toBe('/wt/feature');
  });

  it('follows the agent into and out of plan mode', () => {
    const { result } = renderCallbacks();
    const toolCompleted = (name: string, permission_mode?: string) =>
      envelope('tool_completed', {
        tool: { id: name, name, title: name, status: 'completed', permission_mode },
      });

    act(() => result.current.onEnvelope(toolCompleted('EnterPlanMode')));
    expect(useChatSettingsStore.getState().permissionModeByChat.c1).toBe('plan');

    act(() => result.current.onEnvelope(toolCompleted('ExitPlanMode', 'auto')));
    expect(useChatSettingsStore.getState().permissionModeByChat.c1).toBe('auto');
  });
});

describe('terminal events', () => {
  it('flushes pending content and finalizes the turn on completion', () => {
    const { result } = renderCallbacks();

    act(() => {
      result.current.onEnvelope(text('Done'));
      result.current.onComplete('a1', 's1', 'complete', 1234);
    });

    const expected = {
      content_text: 'Done',
      stream_status: 'completed',
      active_stream_id: null,
      duration_ms: 1234,
    };
    expect(result.current.messages[0]).toMatchObject(expected);
    expect(cachedMessage('c1', 'a1')).toMatchObject(expected);
    expect(result.current.streamState).toBe('idle');
    expect(result.current.currentMessageId).toBeNull();
  });

  it('marks the turn failed with the error appended after the streamed content', () => {
    const toastError = vi.spyOn(toast, 'error');
    const { result } = renderCallbacks();

    act(() => {
      result.current.onEnvelope(text('Partial'));
      result.current.onError(new Error('Overloaded'), 'a1', 's1');
    });

    const failed = result.current.messages[0];
    expect(failed.stream_status).toBe('failed');
    expect(failed.content_render.events).toEqual([
      { type: 'assistant_text', text: 'Partial' },
      { type: 'assistant_text', text: '\n\nError: Overloaded' },
    ]);
    expect(cachedMessage('c1', 'a1')?.stream_status).toBe('failed');
    expect(result.current.streamState).toBe('idle');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('toasts an error that has no message to attach to', () => {
    const toastError = vi.spyOn(toast, 'error');
    const { result } = renderCallbacks();

    act(() => result.current.onError(new Error('Connection lost')));

    expect(toastError).toHaveBeenCalledWith('Connection lost');
    expect(result.current.streamState).toBe('idle');
  });
});

describe('stopStream', () => {
  it('holds envelopes while a stop is pending and replays them if the stop fails', async () => {
    vi.spyOn(chatService, 'stopStream').mockRejectedValue(new Error('offline'));
    const { result } = renderCallbacks();
    result.current.pendingStopRef.current.add('a1');

    act(() => result.current.onEnvelope(text('late')));
    await flushTimers();
    expect(result.current.messages[0].content_text).toBe('');

    await act(() => expect(result.current.stopStream('a1')).rejects.toThrow('offline'));
    await flushTimers();

    expect(result.current.messages[0].content_text).toBe('late');
    expect(result.current.pendingStopRef.current.has('a1')).toBe(false);
  });

  it('finalizes the turn as interrupted when the stop lands with no live stream to cancel', async () => {
    vi.spyOn(chatService, 'stopStream').mockResolvedValue();
    const { result } = renderCallbacks();
    result.current.pendingStopRef.current.add('a1');

    await act(() => result.current.stopStream('a1'));

    expect(result.current.messages[0].stream_status).toBe('interrupted');
    expect(cachedMessage('c1', 'a1')?.stream_status).toBe('interrupted');
    expect(result.current.pendingStopRef.current.has('a1')).toBe(false);
    expect(result.current.streamState).toBe('idle');
  });
});

describe('onQueueProcess', () => {
  it('flushes the prior turn, stamps its duration, and inserts the queued turn', async () => {
    const { result } = renderCallbacks([makeMessage('u1', { role: 'user' }), makeMessage('a1')]);
    seedCache('c1', [makeMessage('a1'), makeMessage('u1', { role: 'user' })]);
    const data: QueueProcessingData = {
      queuedMessageId: 'q1',
      userMessageId: 'u2',
      assistantMessageId: 'a2',
      checkpointId: null,
      content: 'next',
      modelId: 'm',
      priorMessageId: 'a1',
      priorDurationMs: 5000,
    };

    act(() => {
      result.current.onEnvelope(text('tail'));
      result.current.onQueueProcess(data);
    });

    expect(result.current.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(result.current.messages[1]).toMatchObject({ content_text: 'tail', duration_ms: 5000 });
    expect(result.current.currentMessageId).toBe('a2');
    expect(readMessagePages(queryClient, 'c1')?.[0].map((m) => m.id)).toEqual([
      'a2',
      'u2',
      'a1',
      'u1',
    ]);

    act(() => result.current.onEnvelope(text('fresh', { streamId: 's2', messageId: 'a2' })));
    await flushTimers();
    expect(result.current.messages[1].content_text).toBe('tail');
    expect(result.current.messages[3].content_text).toBe('fresh');
  });
});
