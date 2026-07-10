import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chatStore';
import type { Chat } from '@/types/chat.types';

const chat = (id: string): Chat =>
  ({
    id,
    user_id: 'u1',
    title: 'T',
    workspace_id: 'ws',
    sandbox_id: 'sb',
    created_at: '2020-01-01T00:00:00Z',
    updated_at: '2020-01-01T00:00:00Z',
    pinned_at: null,
    worktree_cwd: null,
    parent_chat_id: null,
    sub_thread_count: 0,
    session_agent_kind: null,
    unread: false,
  }) as Chat;

const file = (name: string) => new File(['x'], name);

beforeEach(() => {
  useChatStore.setState({ currentChat: null, attachedFilesByChat: {} });
});

describe('setCurrentChat', () => {
  it('stores and clears the current chat', () => {
    useChatStore.getState().setCurrentChat(chat('c1'));
    expect(useChatStore.getState().currentChat?.id).toBe('c1');
    useChatStore.getState().setCurrentChat(null);
    expect(useChatStore.getState().currentChat).toBeNull();
  });
});

describe('setAttachedFilesForChat', () => {
  it('stores files keyed by chat id', () => {
    const files = [file('a.png')];
    useChatStore.getState().setAttachedFilesForChat('c1', files);
    expect(useChatStore.getState().attachedFilesByChat.c1).toBe(files);
  });

  it('returns the same state when the identical array reference is set again', () => {
    const files = [file('a.png')];
    useChatStore.getState().setAttachedFilesForChat('c1', files);
    const before = useChatStore.getState().attachedFilesByChat;
    useChatStore.getState().setAttachedFilesForChat('c1', files);
    // Reference-equality guard avoids spurious re-renders on no-op writes.
    expect(useChatStore.getState().attachedFilesByChat).toBe(before);
  });

  it('replaces the map when a different array is set', () => {
    useChatStore.getState().setAttachedFilesForChat('c1', [file('a.png')]);
    const before = useChatStore.getState().attachedFilesByChat;
    useChatStore.getState().setAttachedFilesForChat('c1', [file('b.png')]);
    expect(useChatStore.getState().attachedFilesByChat).not.toBe(before);
    expect(useChatStore.getState().attachedFilesByChat.c1[0].name).toBe('b.png');
  });
});

describe('clearAttachedFilesForChat', () => {
  it('drops the slot for a known chat', () => {
    useChatStore.getState().setAttachedFilesForChat('c1', [file('a.png')]);
    useChatStore.getState().clearAttachedFilesForChat('c1');
    expect('c1' in useChatStore.getState().attachedFilesByChat).toBe(false);
  });

  it('returns the same state for an unknown chat', () => {
    const before = useChatStore.getState().attachedFilesByChat;
    useChatStore.getState().clearAttachedFilesForChat('missing');
    expect(useChatStore.getState().attachedFilesByChat).toBe(before);
  });
});

describe('promoteAttachedFiles', () => {
  it('moves files from one chat slot to another and clears the source', () => {
    const files = [file('a.png')];
    useChatStore.getState().setAttachedFilesForChat('pending', files);
    useChatStore.getState().promoteAttachedFiles('pending', 'c1');
    const state = useChatStore.getState().attachedFilesByChat;
    expect(state.c1).toBe(files);
    expect('pending' in state).toBe(false);
  });

  it('is a no-op when the source slot is empty', () => {
    const before = useChatStore.getState().attachedFilesByChat;
    useChatStore.getState().promoteAttachedFiles('missing', 'c1');
    expect(useChatStore.getState().attachedFilesByChat).toBe(before);
  });

  it('drops the files when promoting a slot onto itself', () => {
    // Degenerate same-id case: the copy then delete removes the slot entirely.
    // Not reached in practice (promotion is always PENDING -> real chat id).
    useChatStore.getState().setAttachedFilesForChat('c1', [file('a.png')]);
    useChatStore.getState().promoteAttachedFiles('c1', 'c1');
    expect('c1' in useChatStore.getState().attachedFilesByChat).toBe(false);
  });
});
