// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { checkChatStatus, getStreamByChat, reconcileElicitationRequests } = vi.hoisted(() => ({
  checkChatStatus: vi.fn(),
  getStreamByChat: vi.fn(),
  reconcileElicitationRequests: vi.fn(),
}));

vi.mock('@/services/chatService', () => ({ chatService: { checkChatStatus } }));
vi.mock('@/store/streamStore', () => ({
  useStreamStore: { getState: () => ({ getStreamByChat }) },
}));
vi.mock('@/store/elicitationStore', () => ({
  useElicitationStore: { getState: () => ({ reconcileElicitationRequests }) },
}));

import { useStreamReconnect } from './useStreamReconnect';

const flush = () => new Promise((r) => setTimeout(r, 150));

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

beforeEach(() => {
  vi.clearAllMocks();
  getStreamByChat.mockReturnValue(undefined);
  checkChatStatus.mockResolvedValue({ has_active_task: false, pending_elicitations: [] });
});

describe('useStreamReconnect elicitation hydration', () => {
  it('reconciles the queue with the status snapshot on chat entry', async () => {
    const pending = [
      { request_id: 'elicit-1', message: 'a', tool_call_id: null, requested_schema: {} },
    ];
    checkChatStatus.mockResolvedValue({ has_active_task: false, pending_elicitations: pending });

    renderHook(() => useStreamReconnect(params));
    await flush();

    expect(reconcileElicitationRequests).toHaveBeenCalledWith('c1', pending);
  });

  it('reconciles even when there is no active task to resume', async () => {
    renderHook(() => useStreamReconnect(params));
    await flush();

    expect(reconcileElicitationRequests).toHaveBeenCalledWith('c1', []);
    expect(params.replayStream).not.toHaveBeenCalled();
  });

  it('leaves the queue alone when the server omits the field', async () => {
    checkChatStatus.mockResolvedValue({ has_active_task: false });

    renderHook(() => useStreamReconnect(params));
    await flush();

    expect(reconcileElicitationRequests).not.toHaveBeenCalled();
  });
});
