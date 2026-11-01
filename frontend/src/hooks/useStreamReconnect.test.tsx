// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ElicitationRequest } from '@/types/chat.types';

const { checkChatStatus } = vi.hoisted(() => ({ checkChatStatus: vi.fn() }));

vi.mock('@/services/chatService', () => ({ chatService: { checkChatStatus } }));

import { useStreamReconnect } from './useStreamReconnect';
import { useElicitationStore } from '@/store/elicitationStore';

const elicitation = (id: string): ElicitationRequest => ({
  request_id: id,
  message: id,
  tool_call_id: null,
  requested_schema: { type: 'object', properties: {} },
});

const params = {
  chatId: 'c1',
  fetchedMessages: [],
  hasFetchedMessages: true,
  isInitialLoading: false,
  streamState: 'idle' as const,
  currentMessageId: null,
  wasAborted: false,
  selectedModelId: 'm1',
  setStreamState: vi.fn(),
  setCurrentMessageId: vi.fn(),
  setMessages: vi.fn(),
  addMessageToCache: vi.fn(),
  replayStream: vi.fn().mockResolvedValue('s1'),
};

const pendingIds = () =>
  (useElicitationStore.getState().pendingRequests.get('c1') ?? []).map((r) => r.request_id);

async function enterChat() {
  renderHook(() => useStreamReconnect(params));
  await vi.advanceTimersByTimeAsync(100);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useElicitationStore.setState({ pendingRequests: new Map([['c1', [elicitation('stale')]]]) });
  checkChatStatus.mockResolvedValue({ has_active_task: false, pending_elicitations: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useStreamReconnect elicitation hydration', () => {
  it('reconciles the queue with the status snapshot on chat entry', async () => {
    checkChatStatus.mockResolvedValue({
      has_active_task: false,
      pending_elicitations: [elicitation('elicit-1')],
    });

    await enterChat();

    expect(pendingIds()).toEqual(['elicit-1']);
  });

  it('reconciles even when there is no active task to resume', async () => {
    await enterChat();

    expect(pendingIds()).toEqual([]);
    expect(params.replayStream).not.toHaveBeenCalled();
  });

  it('leaves the queue alone when the server omits the field', async () => {
    checkChatStatus.mockResolvedValue({ has_active_task: false });

    await enterChat();

    expect(pendingIds()).toEqual(['stale']);
  });
});
