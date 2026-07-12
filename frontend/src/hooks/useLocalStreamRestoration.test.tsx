// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getActiveStreams, addStreamMetadataIfAbsent, loggerError } = vi.hoisted(() => ({
  getActiveStreams: vi.fn(),
  addStreamMetadataIfAbsent: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/services/chatService', () => ({ chatService: { getActiveStreams } }));
vi.mock('@/store/streamStore', () => ({
  useStreamStore: { getState: () => ({ addStreamMetadataIfAbsent }) },
}));
vi.mock('@/utils/logger', () => ({ logger: { error: loggerError } }));

import { useLocalStreamRestoration } from './useLocalStreamRestoration';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  getActiveStreams.mockResolvedValue([]);
});

describe('useLocalStreamRestoration', () => {
  it('does nothing while disabled', async () => {
    renderHook(() => useLocalStreamRestoration({ enabled: false }));
    await flush();
    expect(getActiveStreams).not.toHaveBeenCalled();
  });

  it('seeds stream metadata for each active stream once enabled', async () => {
    getActiveStreams.mockResolvedValue([
      { chat_id: 'c1', message_id: 'm1' },
      { chat_id: 'c2', message_id: 'm2' },
    ]);
    renderHook(() => useLocalStreamRestoration({ enabled: true }));
    await flush();

    expect(getActiveStreams).toHaveBeenCalledTimes(1);
    expect(addStreamMetadataIfAbsent).toHaveBeenCalledTimes(2);
    expect(addStreamMetadataIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'c1', messageId: 'm1' }),
    );
  });

  it('restores at most once even across re-renders', async () => {
    const { rerender } = renderHook(({ enabled }) => useLocalStreamRestoration({ enabled }), {
      initialProps: { enabled: true },
    });
    await flush();
    rerender({ enabled: true });
    await flush();
    expect(getActiveStreams).toHaveBeenCalledTimes(1);
  });

  it('logs and swallows a restoration failure', async () => {
    const err = new Error('offline');
    getActiveStreams.mockRejectedValue(err);
    renderHook(() => useLocalStreamRestoration({ enabled: true }));
    await flush();
    expect(loggerError).toHaveBeenCalledWith(
      'Stream restoration failed',
      'useLocalStreamRestoration',
      err,
    );
    expect(addStreamMetadataIfAbsent).not.toHaveBeenCalled();
  });
});
