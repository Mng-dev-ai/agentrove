// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getActiveStreams } = vi.hoisted(() => ({ getActiveStreams: vi.fn() }));

vi.mock('@/services/chatService', () => ({ chatService: { getActiveStreams } }));

import { useLocalStreamRestoration } from './useLocalStreamRestoration';
import { useStreamStore } from '@/store/streamStore';

const flush = () => new Promise((r) => setTimeout(r, 0));
const restoredChatIds = () => useStreamStore.getState().activeStreamMetadata.map((s) => s.chatId);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  useStreamStore.setState({ activeStreamMetadata: [] });
  getActiveStreams.mockResolvedValue([]);
});

describe('useLocalStreamRestoration', () => {
  it('does nothing while disabled', async () => {
    renderHook(() => useLocalStreamRestoration({ enabled: false }));
    await flush();
    expect(getActiveStreams).not.toHaveBeenCalled();
  });

  it('registers each active stream once enabled', async () => {
    getActiveStreams.mockResolvedValue([
      { chat_id: 'c1', message_id: 'm1' },
      { chat_id: 'c2', message_id: 'm2' },
    ]);
    renderHook(() => useLocalStreamRestoration({ enabled: true }));

    await waitFor(() => expect(restoredChatIds()).toEqual(['c1', 'c2']));
    expect(useStreamStore.getState().activeStreamMetadata[0].messageId).toBe('m1');
  });

  it('restores at most once even across re-renders', async () => {
    const { rerender } = renderHook(({ enabled }) => useLocalStreamRestoration({ enabled }), {
      initialProps: { enabled: true },
    });
    await flush();
    rerender({ enabled: false });
    rerender({ enabled: true });
    await flush();
    expect(getActiveStreams).toHaveBeenCalledTimes(1);
  });

  it('logs and swallows a restoration failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getActiveStreams.mockRejectedValue(new Error('offline'));
    renderHook(() => useLocalStreamRestoration({ enabled: true }));

    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(restoredChatIds()).toEqual([]);
  });
});
