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
    ['the infinite chats list', ['chats', 'infinite'], true],
    ['the auth user', ['auth-user'], true],
    ['the top-level workspaces list', ['workspaces'], true],
    ['the cloud chats list', ['cloud', 'chats'], true],
    ['messages', ['messages', 'chat-1'], false],
    ['settings, which carry secrets', ['settings'], false],
    ['a nested workspaces resource', ['workspaces', 'ws-1', 'resources', 'chat-1'], false],
  ])('%s → %s', (_label, key, expected) => {
    expect(shouldPersist(successfulQuery(key))).toBe(expected);
  });
});
