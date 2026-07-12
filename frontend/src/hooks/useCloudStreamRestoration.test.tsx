// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getActiveStreams, addStreamMetadataIfAbsent, loggerError, state } = vi.hoisted(() => ({
  getActiveStreams: vi.fn(),
  addStreamMetadataIfAbsent: vi.fn(),
  loggerError: vi.fn(),
  state: { cloudUrl: 'https://cloud.example' as string | null },
}));

vi.mock('@/services/cloudChatService', () => ({ cloudChatService: { getActiveStreams } }));
vi.mock('@/store/streamStore', () => ({
  useStreamStore: { getState: () => ({ addStreamMetadataIfAbsent }) },
}));
vi.mock('@/store/cloudSettingsStore', () => ({
  // Match the real selector-hook shape the source consumes.
  useCloudSettingsStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock('@/utils/logger', () => ({ logger: { error: loggerError } }));

import { useCloudStreamRestoration } from './useCloudStreamRestoration';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  state.cloudUrl = 'https://cloud.example';
  getActiveStreams.mockResolvedValue([]);
});

describe('useCloudStreamRestoration', () => {
  it('does nothing while disabled', async () => {
    renderHook(() => useCloudStreamRestoration({ enabled: false }));
    await flush();
    expect(getActiveStreams).not.toHaveBeenCalled();
  });

  it('does nothing when no cloudUrl is configured', async () => {
    state.cloudUrl = null;
    renderHook(() => useCloudStreamRestoration({ enabled: true }));
    await flush();
    expect(getActiveStreams).not.toHaveBeenCalled();
  });

  it('seeds metadata for each active cloud stream', async () => {
    getActiveStreams.mockResolvedValue([{ chat_id: 'c1', message_id: 'm1' }]);
    renderHook(() => useCloudStreamRestoration({ enabled: true }));
    await flush();
    expect(addStreamMetadataIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'c1', messageId: 'm1' }),
    );
  });

  it('re-restores when the cloudUrl changes (new connection)', async () => {
    const { rerender } = renderHook(() => useCloudStreamRestoration({ enabled: true }));
    await flush();
    expect(getActiveStreams).toHaveBeenCalledTimes(1);

    state.cloudUrl = 'https://other.example';
    rerender();
    await flush();
    expect(getActiveStreams).toHaveBeenCalledTimes(2);
  });

  it('logs and swallows a restoration failure', async () => {
    const err = new Error('unreachable');
    getActiveStreams.mockRejectedValue(err);
    renderHook(() => useCloudStreamRestoration({ enabled: true }));
    await flush();
    expect(loggerError).toHaveBeenCalledWith(
      'Cloud stream restoration failed',
      'useCloudStreamRestoration',
      err,
    );
  });
});
