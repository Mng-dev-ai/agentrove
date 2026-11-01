// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActiveStreamSnapshot } from '@/types/stream.types';

const { getActiveStreams } = vi.hoisted(() => ({ getActiveStreams: vi.fn() }));

vi.mock('@/services/cloudChatService', () => ({ cloudChatService: { getActiveStreams } }));

import { useCloudStreamRestoration } from './useCloudStreamRestoration';
import { useCloudSettingsStore } from '@/store/cloudSettingsStore';
import { useStreamStore } from '@/store/streamStore';

const snapshot = (chatId: string): ActiveStreamSnapshot => ({
  chat_id: chatId,
  message_id: `${chatId}-msg`,
  stream_id: `${chatId}-stream`,
  last_seq: 0,
});
const flush = () => new Promise((r) => setTimeout(r, 0));
const restoredChatIds = () => useStreamStore.getState().activeStreamMetadata.map((s) => s.chatId);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  useStreamStore.setState({ activeStreamMetadata: [] });
  useCloudSettingsStore.setState({ cloudUrl: 'https://cloud.example' });
  getActiveStreams.mockResolvedValue([]);
});

describe('useCloudStreamRestoration', () => {
  it('does nothing while disabled', async () => {
    renderHook(() => useCloudStreamRestoration({ enabled: false }));
    await flush();
    expect(getActiveStreams).not.toHaveBeenCalled();
  });

  it('does nothing when no cloudUrl is configured', async () => {
    useCloudSettingsStore.setState({ cloudUrl: '' });
    renderHook(() => useCloudStreamRestoration({ enabled: true }));
    await flush();
    expect(getActiveStreams).not.toHaveBeenCalled();
  });

  it('registers each active cloud stream', async () => {
    getActiveStreams.mockResolvedValue([snapshot('c1')]);
    renderHook(() => useCloudStreamRestoration({ enabled: true }));
    await waitFor(() => expect(restoredChatIds()).toEqual(['c1']));
  });

  it('on a cloudUrl switch, drops the old instance response and restores from the new one', async () => {
    let resolveOld: (streams: ActiveStreamSnapshot[]) => void = () => {};
    getActiveStreams
      .mockReturnValueOnce(new Promise((r) => (resolveOld = r)))
      .mockResolvedValueOnce([snapshot('new-chat')]);
    renderHook(() => useCloudStreamRestoration({ enabled: true }));

    act(() => useCloudSettingsStore.setState({ cloudUrl: 'https://other.example' }));
    await waitFor(() => expect(restoredChatIds()).toEqual(['new-chat']));

    resolveOld([snapshot('old-chat')]);
    await flush();
    expect(restoredChatIds()).toEqual(['new-chat']);
  });

  it('logs and swallows a restoration failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getActiveStreams.mockRejectedValue(new Error('unreachable'));
    renderHook(() => useCloudStreamRestoration({ enabled: true }));
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(restoredChatIds()).toEqual([]);
  });
});
