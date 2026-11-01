// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useStreamStore } from '@/store/streamStore';
import { useGlobalStream } from './useGlobalStream';

const { checkChatStatus } = vi.hoisted(() => ({ checkChatStatus: vi.fn() }));

vi.mock('@/services/chatService', () => ({ chatService: { checkChatStatus } }));
vi.mock('@/utils/logger', () => ({ logger: { error: vi.fn() } }));

const INITIAL_PRUNE_MS = 500;

const track = (chatId: string) =>
  useStreamStore.getState().addStreamMetadata({ chatId, messageId: `${chatId}-msg`, startTime: 0 });

const trackedChats = () => useStreamStore.getState().activeStreamMetadata.map((m) => m.chatId);
const completed = () => useStreamStore.getState().completedChatIds;

beforeEach(() => {
  vi.useFakeTimers();
  checkChatStatus.mockReset();
  useStreamStore.setState({
    activeStreams: new Map(),
    streamIdByChatMessage: new Map(),
    activeStreamMetadata: [],
    completedChatIds: new Set(),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useGlobalStream', () => {
  it('prunes settled orphan streams with a Done badge and keeps ones still running', async () => {
    track('settled');
    track('running');
    checkChatStatus.mockImplementation(async (chatId: string) => ({
      has_active_task: chatId === 'running',
    }));

    renderHook(() => useGlobalStream());
    await vi.advanceTimersByTimeAsync(INITIAL_PRUNE_MS);

    expect(trackedChats()).toEqual(['running']);
    expect([...completed()]).toEqual(['settled']);
  });

  it('never probes or prunes a chat with a live foreground stream', async () => {
    track('live');
    useStreamStore.getState().addStream({
      id: 's1',
      chatId: 'live',
      messageId: 'live-msg',
      startTime: 0,
      isActive: true,
    });

    renderHook(() => useGlobalStream());
    await vi.advanceTimersByTimeAsync(INITIAL_PRUNE_MS);

    expect(checkChatStatus).not.toHaveBeenCalled();
    expect(trackedChats()).toEqual(['live']);
  });

  it('keeps a chat whose foreground stream attached while the status probe was in flight', async () => {
    track('racing');
    checkChatStatus.mockImplementation(async () => {
      useStreamStore.getState().addStream({
        id: 's1',
        chatId: 'racing',
        messageId: 'racing-msg',
        startTime: 0,
        isActive: true,
      });
      return { has_active_task: false };
    });

    renderHook(() => useGlobalStream());
    await vi.advanceTimersByTimeAsync(INITIAL_PRUNE_MS);

    expect(trackedChats()).toEqual(['racing']);
    expect(useStreamStore.getState().getStreamByChat('racing')?.isActive).toBe(true);
  });

  it('prunes without a Done badge when the status probe fails', async () => {
    track('unknown');
    checkChatStatus.mockRejectedValue(new Error('offline'));

    renderHook(() => useGlobalStream());
    await vi.advanceTimersByTimeAsync(INITIAL_PRUNE_MS);

    expect(trackedChats()).toEqual([]);
    expect(completed().size).toBe(0);
  });
});
