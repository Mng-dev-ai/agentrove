import { describe, expect, it } from 'vitest';
import type { Channel } from '@/types/channel.types';
import type { Chat } from '@/types/chat.types';
import { resolveRootTarget } from './rootTarget';

const chat = (id: string, updatedAt: string) => ({ id, updated_at: updatedAt }) as Chat;
const channel = (id: string, updatedAt: string) => ({ id, updated_at: updatedAt }) as Channel;

const chats = [
  chat('older-chat', '2026-07-01T10:00:00Z'),
  chat('gone-chat', '2026-07-03T10:00:00Z'),
];
const channels = [channel('newest-channel', '2026-07-02T10:00:00Z')];

describe('resolveRootTarget', () => {
  it('opens the recorded thread while it exists', () => {
    expect(
      resolveRootTarget({
        lastThread: { kind: 'chat', id: 'sub-thread' },
        lastThreadStatus: 'exists',
        chats,
        channels,
        isLoadingThreads: true,
      }),
    ).toEqual({ kind: 'thread', path: '/chat/sub-thread' });
  });

  it('waits while the recorded thread is being checked', () => {
    expect(
      resolveRootTarget({
        lastThread: { kind: 'channel', id: 'c' },
        lastThreadStatus: 'pending',
        chats,
        channels,
        isLoadingThreads: false,
      }),
    ).toEqual({ kind: 'loading' });
  });

  it('falls back to the newest other thread when the recorded one is gone', () => {
    expect(
      resolveRootTarget({
        lastThread: { kind: 'chat', id: 'gone-chat' },
        lastThreadStatus: 'gone',
        chats,
        channels,
        isLoadingThreads: false,
      }),
    ).toEqual({ kind: 'thread', path: '/channels/newest-channel' });
  });

  it('falls back to the newest thread without a record, once the lists load', () => {
    const input = {
      lastThread: null,
      lastThreadStatus: 'gone' as const,
      chats,
      channels,
    };
    expect(resolveRootTarget({ ...input, isLoadingThreads: true })).toEqual({ kind: 'loading' });
    expect(resolveRootTarget({ ...input, isLoadingThreads: false })).toEqual({
      kind: 'thread',
      path: '/chat/gone-chat',
    });
  });

  it('shows the empty state when no thread is left', () => {
    expect(
      resolveRootTarget({
        lastThread: { kind: 'chat', id: 'gone-chat' },
        lastThreadStatus: 'gone',
        chats: [chat('gone-chat', '2026-07-03T10:00:00Z')],
        channels: [],
        isLoadingThreads: false,
      }),
    ).toEqual({ kind: 'empty' });
  });
});
