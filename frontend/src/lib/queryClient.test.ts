// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { QueryClient, type Query } from '@tanstack/react-query';
import { persistOptions } from './queryClient';

const shouldPersist = persistOptions.dehydrateOptions!.shouldDehydrateQuery!;

function successfulQuery(key: readonly unknown[]): Query {
  const client = new QueryClient();
  client.setQueryData(key, { ok: true });
  return client.getQueryCache().find({ queryKey: key })!;
}

describe('shouldPersistQuery', () => {
  it.each([
    ['the infinite chats list', ['machine', 'local', 'chats', 'infinite'], true],
    ['the auth user', ['auth-user'], true],
    ['the top-level workspaces list', ['machine', 'local', 'workspaces'], true],
    ['a machine chat page', ['machine', 'm1', 'chats', 'page', 1], true],
    ['machine settings', ['machine', 'm1', 'settings'], false],
    ['messages', ['messages', 'chat-1'], false],
    ['settings, which carry secrets', ['machine', 'local', 'settings'], false],
    [
      'a nested workspaces resource',
      ['machine', 'local', 'workspaces', 'ws-1', 'resources'],
      false,
    ],
  ])('%s → %s', (_label, key, expected) => {
    expect(shouldPersist(successfulQuery(key))).toBe(expected);
  });
});
