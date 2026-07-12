// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { QueryClient, type Query } from '@tanstack/react-query';
import { persistOptions } from './queryClient';

const shouldPersist = persistOptions.dehydrateOptions!.shouldDehydrateQuery!;

// Builds a real, successful Query for `key` so defaultShouldDehydrateQuery (which
// gates on status === 'success') passes and only the key-matching branch decides.
function query(key: readonly unknown[]): Query {
  const client = new QueryClient();
  client.setQueryData(key, { ok: true });
  return client.getQueryCache().find({ queryKey: key })!;
}

describe('shouldPersistQuery', () => {
  it('persists the infinite chats list', () => {
    expect(shouldPersist(query(['chats', 'infinite']))).toBe(true);
  });

  it('persists the auth user query', () => {
    expect(shouldPersist(query(['auth-user']))).toBe(true);
  });

  it('persists the top-level workspaces query', () => {
    expect(shouldPersist(query(['workspaces']))).toBe(true);
  });

  it('persists the cloud chats list', () => {
    expect(shouldPersist(query(['cloud', 'chats']))).toBe(true);
  });

  it('does not persist messages', () => {
    expect(shouldPersist(query(['messages', 'chat-1']))).toBe(false);
  });

  it('does not persist settings (carries secrets)', () => {
    expect(shouldPersist(query(['settings']))).toBe(false);
  });

  it('does not persist a nested workspaces resource query', () => {
    // Only the length-1 workspaces key is whitelisted.
    expect(shouldPersist(query(['workspaces', 'ws-1', 'resources', 'chat-1']))).toBe(false);
  });
});
