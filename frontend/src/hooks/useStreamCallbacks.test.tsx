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
import { streamConnection } from '@/services/streamConnection';
import { streamService } from '@/services/streamService';
import { useChatSettingsStore, type PermissionMode } from '@/store/chatSettingsStore';
import { useStreamStore } from '@/store/streamStore';
import { LOCAL_MACHINE_ID } from '@/types/machine.types';
import type { Chat, Message, PermissionOption } from '@/types/chat.types';
import type { QueueProcessingData, StreamEnvelope } from '@/types/stream.types';
import { makeMessage, readMessagePages, seedMessagePages, wireEnvelope } from '@/test/fixtures';
import streamEnvelopes from '@/test/streamEnvelopes.json';
import { useStreamCallbacks } from './useStreamCallbacks';

// The real connection opens an EventSource for any registered stream and fails it.
vi.mock('@/services/streamConnection', () => ({
  streamConnection: { configure: vi.fn(), requestReplay: vi.fn() },
}));

// streamService registers its raw-data handler once, when the module loads.
const deliverRawEnvelope = vi.mocked(streamConnection.configure).mock.calls[0][0].onEnvelopeData;
const ENVELOPE_IDS: EnvelopeIds = { chatId: 'c1', messageId: 'a1', streamId: 's1', seq: 1 };
const ALLOW_OPTION: PermissionOption = {
  kind: 'allow_once',
  name: 'Allow',
  option_id: 'allow',
  permission_mode: null,
};

type EnvelopeIds = Pick<StreamEnvelope, 'chatId' | 'messageId' | 'streamId' | 'seq'>;
type EnvelopeBodyOf<E> = E extends unknown ? Omit<E, keyof EnvelopeIds> : never;
type EnvelopeBody = EnvelopeBodyOf<StreamEnvelope>;

function envelope(body: EnvelopeBody, overrides: Partial<EnvelopeIds> = {}): StreamEnvelope {
  return { ...ENVELOPE_IDS, ...body, ...overrides };
}

const text = (value: string, overrides?: Partial<EnvelopeIds>) =>
  envelope({ kind: 'assistant_text', payload: { text: value } }, overrides);

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
      const currentMessageIdRef = useRef(currentMessageId);
      currentMessageIdRef.current = currentMessageId;
      const streamStateRef = useRef(streamState);
      streamStateRef.current = streamState;
      const callbacks = useStreamCallbacks({
        messages,
        chatId: 'c1',
        currentChat: { id: 'c1', sandbox_id: 'sb1', parent_chat_id: null } as Chat,
        queryClient,
        setMessages,
        setStreamState,
        setCurrentMessageId,
        pendingStopRef,
        currentMessageIdRef,
        streamStateRef,
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
  queryClient.setQueryData(queryKeys.machine.settings(LOCAL_MACHINE_ID), {
    notifications_enabled: false,
  });
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
          {
            kind: 'permission_request',
            payload: {
              request_id: 'p1',
              tool_name: 'Bash',
              tool_input: { command: 'ls' },
              data: { options: [ALLOW_OPTION] },
            },
          },
          { seq: 7 },
        ),
      );
      result.current.onEnvelope(
        wireEnvelope({
          ...ENVELOPE_IDS,
          kind: 'permission_request',
          payload: { request_id: 'p2', tool_name: 'Bash' },
        }),
      );
      result.current.onEnvelope(
        wireEnvelope({
          ...ENVELOPE_IDS,
          kind: 'elicitation_request',
          payload: { request_id: 'e1', data: { message: 'Pick one' } },
        }),
      );
      result.current.onEnvelope(
        envelope({ kind: 'elicitation_dismissed', payload: { request_id: 'e0' } }),
      );
    });
    await flushTimers();

    expect(handlers.onPermissionRequest).toHaveBeenCalledTimes(1);
    expect(handlers.onPermissionRequest).toHaveBeenCalledWith({
      request_id: 'p1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      options: [ALLOW_OPTION],
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
        envelope({
          kind: 'system',
          payload: { data: { chat_id: 'c1', context_usage: usage, worktree_cwd: '/wt/feature' } },
        }),
      ),
    );

    expect(handlers.onContextUsageUpdate).toHaveBeenCalledWith(usage, 'c1');
    expect(queryClient.getQueryData<Chat>(queryKeys.chat('c1'))?.worktree_cwd).toBe('/wt/feature');
  });

  // backend/tests/test_stream_envelopes.py holds StreamEnvelopeKind to the same file.
  it('carries every backend envelope kind from raw stream data to its handler', async () => {
    queryClient.setQueryData(queryKeys.chat('c1'), { id: 'c1', worktree_cwd: null } as Chat);
    const rateLimitsKey = queryKeys.machine.rateLimits(LOCAL_MACHINE_ID);
    queryClient.setQueryData(rateLimitsKey, { windows: {}, is_using_overage: false });
    const { result } = renderCallbacks();
    const sent = streamEnvelopes.map((entry) => ({ ...entry, ...ENVELOPE_IDS, seq: entry.seq }));
    const received: StreamEnvelope[] = [];
    const callbacks = {
      onEnvelope: (envelope: StreamEnvelope) => {
        received.push(envelope);
        result.current.onEnvelope(envelope);
      },
      onComplete: vi.fn(),
      onError: vi.fn(),
      onQueueProcess: vi.fn(),
    };

    await act(async () => {
      for (const entry of sent) {
        // Terminal kinds drop the stream and a queue handoff repoints it.
        const stale = useStreamStore.getState().getStreamByChat('c1');
        if (stale) useStreamStore.getState().removeStream(stale.id);
        await streamService.replayStream({ chatId: 'c1', messageId: 'a1', ...callbacks });
        deliverRawEnvelope(JSON.stringify(entry));
      }
    });
    await flushTimers();

    expect(received).toEqual(sent.filter((entry) => entry.kind !== 'queue_processing'));
    const entryOf = (kind: StreamEnvelope['kind']) => sent.find((entry) => entry.kind === kind)!;
    const systemPayloads = sent.filter((entry) => entry.kind === 'system').map((e) => e.payload);

    const queued = entryOf('queue_processing').payload;
    expect(callbacks.onQueueProcess).toHaveBeenCalledWith({
      queuedMessageId: queued.queued_message_id,
      userMessageId: queued.user_message_id,
      assistantMessageId: queued.assistant_message_id,
      checkpointId: queued.checkpoint_id,
      content: queued.content,
      modelId: queued.model_id,
      attachments: queued.attachments,
      priorMessageId: 'a1',
      priorDurationMs: queued.prior_duration_ms,
    });
    expect(callbacks.onComplete.mock.calls).toEqual([
      ['a1', 's1', 'complete', entryOf('complete').payload.duration_ms],
      ['a1', 's1', 'cancelled', entryOf('cancelled').payload.duration_ms],
    ]);
    expect(callbacks.onError.mock.calls[0][0].getDetailedMessage()).toContain(
      entryOf('error').payload.error,
    );

    const permission = entryOf('permission_request');
    expect(handlers.onPermissionRequest).toHaveBeenCalledWith({
      request_id: permission.payload.request_id,
      tool_name: permission.payload.tool_name,
      tool_input: permission.payload.tool_input,
      options: permission.payload.data?.options,
      seq: permission.seq,
    });
    const elicitation = entryOf('elicitation_request').payload;
    expect(handlers.onElicitationRequest).toHaveBeenCalledWith({
      request_id: elicitation.request_id,
      message: elicitation.data?.message,
      tool_call_id: elicitation.data?.tool_call_id,
      requested_schema: elicitation.data?.requested_schema,
    });
    expect(handlers.onElicitationDismissed).toHaveBeenCalledWith(
      entryOf('elicitation_dismissed').payload.request_id,
    );
    const usage = systemPayloads.find((payload) => payload.context_usage)!;
    expect(handlers.onContextUsageUpdate).toHaveBeenCalledWith(usage.context_usage, usage.chat_id);
    expect(systemPayloads.some((payload) => payload.rate_limits_changed)).toBe(true);
    expect(queryClient.getQueryState(rateLimitsKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData<Chat>(queryKeys.chat('c1'))?.worktree_cwd).toBe(
      systemPayloads.find((payload) => payload.data?.worktree_cwd)!.data?.worktree_cwd,
    );
    expect(result.current.messages[0].content_render.events.map((event) => event.type)).toEqual([
      'assistant_thinking',
      'assistant_text',
      'tool_started',
      'tool_completed',
      'tool_failed',
      'plan',
      'user_steering',
      'prompt_suggestions',
    ]);
  });

  it('follows the agent into and out of plan mode', () => {
    const { result } = renderCallbacks();
    const toolCompleted = (name: string, permission_mode?: PermissionMode) =>
      envelope({
        kind: 'tool_completed',
        payload: { tool: { id: name, name, title: name, status: 'completed', permission_mode } },
      });

    act(() => result.current.onEnvelope(toolCompleted('EnterPlanMode')));
    expect(useChatSettingsStore.getState().permissionModeByChat.c1).toBe('plan');

    act(() => result.current.onEnvelope(toolCompleted('ExitPlanMode', 'auto')));
    expect(useChatSettingsStore.getState().permissionModeByChat.c1).toBe('auto');
  });

  it("refreshes only the stream chat's worktree git state, once per window after a burst", () => {
    queryClient.setQueryData(queryKeys.chat('c1'), {
      id: 'c1',
      sandbox_id: 'sb1',
      worktree_cwd: '/wt/a',
    } as Chat);
    const ownStats = queryKeys.sandbox.gitDiffStats('sb1', '/wt/a');
    const otherStats = queryKeys.sandbox.gitDiffStats('sb1', '/wt/b');
    queryClient.setQueryData(ownStats, {});
    queryClient.setQueryData(otherStats, {});
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderCallbacks();

    act(() => {
      for (const id of ['t1', 't2', 't3']) {
        result.current.onEnvelope(
          envelope({
            kind: 'tool_completed',
            payload: { tool: { id, name: 'Edit', title: id, status: 'completed' } },
          }),
        );
      }
    });
    act(() => vi.advanceTimersByTime(2999));
    expect(queryClient.getQueryState(ownStats)?.isInvalidated).toBe(false);

    act(() => vi.advanceTimersByTime(1));
    expect(queryClient.getQueryState(ownStats)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherStats)?.isInvalidated).toBe(false);
    expect(
      invalidate.mock.calls.filter(
        ([filters]) =>
          JSON.stringify(filters?.queryKey) === JSON.stringify(queryKeys.sandbox.gitDiffAll('sb1')),
      ),
    ).toHaveLength(1);
  });

  it('defers a git refresh due while the worktree query is fetching until it settles', async () => {
    queryClient.setQueryData(queryKeys.chat('c1'), {
      id: 'c1',
      sandbox_id: 'sb1',
      worktree_cwd: '/wt/a',
    } as Chat);
    const ownStats = queryKeys.sandbox.gitDiffStats('sb1', '/wt/a');
    let settle: (value: object) => void = () => {};
    void queryClient.prefetchQuery({
      queryKey: ownStats,
      queryFn: () => new Promise<object>((resolve) => (settle = resolve)),
    });
    const { result } = renderCallbacks();

    act(() =>
      result.current.onEnvelope(
        envelope({
          kind: 'tool_completed',
          payload: { tool: { id: 't1', name: 'Edit', title: 't1', status: 'completed' } },
        }),
      ),
    );
    act(() => vi.advanceTimersByTime(3000));
    expect(queryClient.getQueryState(ownStats)).toMatchObject({
      fetchStatus: 'fetching',
      isInvalidated: false,
    });

    await act(async () => settle({}));
    expect(queryClient.getQueryState(ownStats)?.isInvalidated).toBe(false);

    act(() => vi.advanceTimersByTime(3000));
    expect(queryClient.getQueryState(ownStats)?.isInvalidated).toBe(true);
  });

  it('keeps a pending git refresh across unmount so a chat switch does not lose it', () => {
    queryClient.setQueryData(queryKeys.chat('c1'), {
      id: 'c1',
      sandbox_id: 'sb1',
      worktree_cwd: null,
    } as Chat);
    const stats = queryKeys.sandbox.gitDiffStats('sb1', undefined);
    queryClient.setQueryData(stats, {});
    const { result, unmount } = renderCallbacks();

    act(() =>
      result.current.onEnvelope(
        envelope({
          kind: 'tool_completed',
          payload: { tool: { id: 't1', name: 'Edit', title: 't1', status: 'completed' } },
        }),
      ),
    );
    unmount();
    vi.advanceTimersByTime(3000);

    expect(queryClient.getQueryState(stats)?.isInvalidated).toBe(true);
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
      attachments: null,
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
