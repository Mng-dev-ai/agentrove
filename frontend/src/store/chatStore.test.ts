import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chatStore';

const file = (name: string) => new File(['x'], name);
const attached = () => useChatStore.getState().attachedFilesByChat;

beforeEach(() => {
  useChatStore.setState({ currentChat: null, attachedFilesByChat: {} });
});

describe('setAttachedFilesForChat', () => {
  it('keeps the map reference when the identical array is set again', () => {
    const files = [file('a.png')];
    useChatStore.getState().setAttachedFilesForChat('c1', files);
    const before = attached();
    useChatStore.getState().setAttachedFilesForChat('c1', files);
    expect(attached()).toBe(before);
  });
});

describe('clearAttachedFilesForChat', () => {
  it('drops the slot for a known chat', () => {
    useChatStore.getState().setAttachedFilesForChat('c1', [file('a.png')]);
    useChatStore.getState().clearAttachedFilesForChat('c1');
    expect('c1' in attached()).toBe(false);
  });

  it('keeps the map reference for an unknown chat', () => {
    const before = attached();
    useChatStore.getState().clearAttachedFilesForChat('missing');
    expect(attached()).toBe(before);
  });
});

describe('promoteAttachedFiles', () => {
  it('moves files from one chat slot to another and clears the source', () => {
    const files = [file('a.png')];
    useChatStore.getState().setAttachedFilesForChat('pending', files);
    useChatStore.getState().promoteAttachedFiles('pending', 'c1');
    expect(attached().c1).toBe(files);
    expect('pending' in attached()).toBe(false);
  });

  it('is a no-op when the source slot is empty', () => {
    const before = attached();
    useChatStore.getState().promoteAttachedFiles('missing', 'c1');
    expect(attached()).toBe(before);
  });
});
