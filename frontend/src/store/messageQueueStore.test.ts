// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useMessageQueueStore, EMPTY_QUEUE, sendQueuedMessageNow } from './messageQueueStore';
import { useStreamStore } from './streamStore';
import { queueService } from '@/services/queueService';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/hooks/queries/queryKeys';
import type { LocalQueuedMessage } from '@/types/queue.types';
import { NetworkError } from '@/types/errors.types';

vi.mock('@/services/queueService', () => ({
  queueService: {
    queueMessage: vi.fn(),
    getQueue: vi.fn(),
    updateQueuedMessage: vi.fn(),
    deleteQueuedMessage: vi.fn(),
    sendNow: vi.fn(),
    clearQueue: vi.fn(),
  },
}));

const svc = vi.mocked(queueService);

const localMsg = (over: Partial<LocalQueuedMessage> & { id: string }): LocalQueuedMessage => ({
  content: 'hi',
  queuedAt: 1000,
  synced: true,
  sendingNow: false,
  ...over,
});

const seed = (chatId: string, msgs: LocalQueuedMessage[]) => {
  useMessageQueueStore.setState({ queues: new Map([[chatId, msgs]]) });
};

const queueOf = (chatId: string) => useMessageQueueStore.getState().getQueue(chatId);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useMessageQueueStore.setState({ queues: new Map() });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('queueMessage', () => {
  it('optimistically adds a message, then swaps in the server id and marks it synced', async () => {
    svc.queueMessage.mockResolvedValue({ id: 'server-1', send_now_failed: false });
    const returned = await useMessageQueueStore.getState().queueMessage('c1', 'hello', 'gpt-5');

    expect(returned).toEqual({ id: 'server-1', send_now_failed: false });
    expect(queueOf('c1')).toHaveLength(1);
    expect(queueOf('c1')[0]).toMatchObject({ id: 'server-1', content: 'hello', synced: true });
  });

  it('keeps the unsynced local message on a network error and returns the temp id', async () => {
    svc.queueMessage.mockRejectedValue(new NetworkError());
    const returned = await useMessageQueueStore.getState().queueMessage('c1', 'hello', 'gpt-5');

    expect(queueOf('c1')).toHaveLength(1);
    expect(queueOf('c1')[0]).toMatchObject({ id: returned.id, synced: false });
  });

  it('rolls back the optimistic add and rethrows on a non-network error', async () => {
    svc.queueMessage.mockRejectedValue(new Error('boom'));
    await expect(
      useMessageQueueStore.getState().queueMessage('c1', 'hello', 'gpt-5'),
    ).rejects.toThrow('boom');
    expect(queueOf('c1')).toBe(EMPTY_QUEUE);
  });

  it('does not queue locally when sending immediately succeeds', async () => {
    svc.queueMessage.mockResolvedValue({ id: 'server-1', send_now_failed: false });
    await useMessageQueueStore.getState().queueMessage('c1', 'hello', 'gpt-5', { sendNow: true });
    expect(queueOf('c1')).toBe(EMPTY_QUEUE);
  });

  it('falls back to an unsynced queued message when sending immediately hits a network error', async () => {
    svc.queueMessage.mockRejectedValue(new NetworkError());
    const returned = await useMessageQueueStore
      .getState()
      .queueMessage('c1', 'hello', 'gpt-5', { sendNow: true });

    expect(queueOf('c1')).toHaveLength(1);
    expect(queueOf('c1')[0]).toMatchObject({ id: returned.id, content: 'hello', synced: false });
  });
});

describe('updateQueuedMessage', () => {
  it('trims and updates content locally, syncing when the message is on the server', async () => {
    seed('c1', [localMsg({ id: 'm1', synced: true })]);
    await useMessageQueueStore.getState().updateQueuedMessage('c1', 'm1', '  edited  ');

    expect(queueOf('c1')[0].content).toBe('edited');
    expect(svc.updateQueuedMessage).toHaveBeenCalledWith('c1', 'm1', 'edited');
  });

  it('does not hit the server for an unsynced local edit', async () => {
    seed('c1', [localMsg({ id: 'm1', synced: false })]);
    await useMessageQueueStore.getState().updateQueuedMessage('c1', 'm1', 'edited');

    expect(queueOf('c1')[0].content).toBe('edited');
    expect(svc.updateQueuedMessage).not.toHaveBeenCalled();
  });

  it('is a no-op for an unknown message', async () => {
    seed('c1', [localMsg({ id: 'm1' })]);
    await useMessageQueueStore.getState().updateQueuedMessage('c1', 'missing', 'edited');

    expect(queueOf('c1')[0].content).toBe('hi');
    expect(svc.updateQueuedMessage).not.toHaveBeenCalled();
  });

  it('removes the message when the edited content is blank', async () => {
    seed('c1', [localMsg({ id: 'm1', synced: true })]);
    await useMessageQueueStore.getState().updateQueuedMessage('c1', 'm1', '   ');

    expect(queueOf('c1')).toBe(EMPTY_QUEUE);
    expect(svc.deleteQueuedMessage).toHaveBeenCalledWith('c1', 'm1');
  });
});

describe('removeMessage', () => {
  it('removes a synced message and deletes it on the server', async () => {
    seed('c1', [localMsg({ id: 'm1', synced: true }), localMsg({ id: 'm2', synced: true })]);
    await useMessageQueueStore.getState().removeMessage('c1', 'm1');

    expect(queueOf('c1').map((m) => m.id)).toEqual(['m2']);
    expect(svc.deleteQueuedMessage).toHaveBeenCalledWith('c1', 'm1');
  });

  it('drops the chat bucket when the last message is removed', async () => {
    seed('c1', [localMsg({ id: 'm1', synced: true })]);
    await useMessageQueueStore.getState().removeMessage('c1', 'm1');
    expect(useMessageQueueStore.getState().queues.has('c1')).toBe(false);
  });

  it('does not call the server for an unsynced message', async () => {
    seed('c1', [localMsg({ id: 'm1', synced: false })]);
    await useMessageQueueStore.getState().removeMessage('c1', 'm1');
    expect(svc.deleteQueuedMessage).not.toHaveBeenCalled();
  });
});

describe('sendNow', () => {
  it.each([
    ['an unsynced message', 'm1'],
    ['an unknown message', 'missing'],
  ])('returns false for %s and never calls the server', async (_label, messageId) => {
    seed('c1', [localMsg({ id: 'm1', synced: false })]);
    expect(await useMessageQueueStore.getState().sendNow('c1', messageId)).toBe(false);
    expect(svc.sendNow).not.toHaveBeenCalled();
  });

  it('sends a synced message and leaves sendingNow set on success', async () => {
    svc.sendNow.mockResolvedValue(undefined);
    seed('c1', [localMsg({ id: 'm1', synced: true })]);
    const ok = await useMessageQueueStore.getState().sendNow('c1', 'm1');

    expect(ok).toBe(true);
    expect(svc.sendNow).toHaveBeenCalledWith('c1', 'm1');
    expect(queueOf('c1')[0].sendingNow).toBe(true);
  });

  it('resets sendingNow and returns false when the send fails', async () => {
    svc.sendNow.mockRejectedValue(new Error('nope'));
    seed('c1', [localMsg({ id: 'm1', synced: true })]);
    const ok = await useMessageQueueStore.getState().sendNow('c1', 'm1');

    expect(ok).toBe(false);
    expect(queueOf('c1')[0].sendingNow).toBe(false);
  });

  it('resets sendingNow after 30s if the send never settles', () => {
    vi.useFakeTimers();
    svc.sendNow.mockReturnValue(new Promise(() => {}));
    seed('c1', [localMsg({ id: 'm1', synced: true })]);

    void useMessageQueueStore.getState().sendNow('c1', 'm1');
    expect(queueOf('c1')[0].sendingNow).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(queueOf('c1')[0].sendingNow).toBe(false);
  });
});

describe('sendQueuedMessageNow', () => {
  beforeEach(() => {
    useStreamStore.setState({ activeStreams: new Map(), streamIdByChatMessage: new Map() });
    queryClient.clear();
    svc.sendNow.mockResolvedValue(undefined);
  });

  it('drops the message and refetches chat messages when no stream will pick it up', async () => {
    queryClient.setQueryData(queryKeys.messages('c1'), []);
    seed('c1', [localMsg({ id: 'm1', synced: true })]);

    await sendQueuedMessageNow('c1', 'm1');

    expect(queueOf('c1')).toBe(EMPTY_QUEUE);
    expect(queryClient.getQueryState(queryKeys.messages('c1'))?.isInvalidated).toBe(true);
  });

  it('leaves the message for the active stream to consume', async () => {
    useStreamStore.getState().addStream({
      id: 's1',
      chatId: 'c1',
      messageId: 'a1',
      startTime: 0,
      isActive: true,
    });
    seed('c1', [localMsg({ id: 'm1', synced: true })]);

    await sendQueuedMessageNow('c1', 'm1');

    expect(queueOf('c1')[0]).toMatchObject({ id: 'm1', sendingNow: true });
  });
});

describe('fetchQueue', () => {
  it('replaces synced locals with server state and appends unsynced pending locals', async () => {
    seed('c1', [
      localMsg({ id: 'temp', synced: false, content: 'pending' }),
      localMsg({ id: 's1', synced: true, content: 'stale' }),
    ]);
    svc.getQueue.mockResolvedValue([
      {
        id: 's1',
        content: 'fresh',
        model_id: 'm',
        permission_mode: 'default',
        thinking_mode: null,
        worktree: false,
        fast_mode: false,
        selected_persona_name: 'Default',
        queued_at: '2020-01-01T00:00:00Z',
        attachments: [],
      },
    ]);

    await useMessageQueueStore.getState().fetchQueue('c1');
    const queue = queueOf('c1');
    expect(queue.map((m) => m.id)).toEqual(['s1', 'temp']);
    expect(queue[0]).toMatchObject({
      content: 'fresh',
      synced: true,
      queuedAt: new Date('2020-01-01T00:00:00Z').getTime(),
    });
    expect(queue[1]).toMatchObject({ content: 'pending', synced: false });
  });

  it('drops the bucket when the server has nothing and no locals are pending', async () => {
    seed('c1', [localMsg({ id: 's1', synced: true })]);
    svc.getQueue.mockResolvedValue([]);

    await useMessageQueueStore.getState().fetchQueue('c1');
    expect(useMessageQueueStore.getState().queues.has('c1')).toBe(false);
  });

  it('swallows fetch errors and leaves existing state intact', async () => {
    seed('c1', [localMsg({ id: 'm1' })]);
    svc.getQueue.mockRejectedValue(new Error('offline'));

    await useMessageQueueStore.getState().fetchQueue('c1');
    expect(queueOf('c1').map((m) => m.id)).toEqual(['m1']);
  });
});
