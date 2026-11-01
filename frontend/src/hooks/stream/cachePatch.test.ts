// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queries/queryKeys';
import type { PaginatedMessages } from '@/types/api.types';
import type { Chat, Message } from '@/types/chat.types';
import { insertMessagesInCache, insertStartedTurnInCache } from './cachePatch';

function makeMessage(id: string, role: Message['role'] = 'assistant'): Message {
  return {
    id,
    chat_id: 'c1',
    role,
    content_text: '',
    content_render: { events: [] },
    last_seq: 0,
    active_stream_id: null,
    stream_status: 'completed',
    created_at: '2024-01-01T00:00:00Z',
    model_id: null,
    duration_ms: null,
    attachments: [],
    checkpoint_id: null,
    tool_results_omitted: false,
  };
}

function page(...ids: string[]): PaginatedMessages {
  return { items: ids.map((id) => makeMessage(id)), next_cursor: null, has_more: false };
}

type MessagesData = { pages: PaginatedMessages[]; pageParams: unknown[] };

function cachedIds(queryClient: QueryClient, chatId = 'c1'): string[][] | undefined {
  return queryClient
    .getQueryData<MessagesData>(queryKeys.messages(chatId))
    ?.pages.map((p) => p.items.map((m) => m.id));
}

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient();
});

describe('insertMessagesInCache', () => {
  it('prepends a new turn to the newest page in newest-first order', () => {
    queryClient.setQueryData<MessagesData>(queryKeys.messages('c1'), {
      pages: [page('a1', 'u1'), page('a0', 'u0')],
      pageParams: [null, 'cursor'],
    });

    insertMessagesInCache(queryClient, 'c1', [makeMessage('u2', 'user'), makeMessage('a2')]);

    expect(cachedIds(queryClient)).toEqual([
      ['a2', 'u2', 'a1', 'u1'],
      ['a0', 'u0'],
    ]);
  });

  it('slots a missing user message ahead of its already-cached assistant reply', () => {
    queryClient.setQueryData<MessagesData>(queryKeys.messages('c1'), {
      pages: [page('a2', 'a1', 'u1')],
      pageParams: [null],
    });

    insertMessagesInCache(queryClient, 'c1', [makeMessage('u2', 'user'), makeMessage('a2')]);

    expect(cachedIds(queryClient)).toEqual([['a2', 'u2', 'a1', 'u1']]);
  });

  it('skips messages already present on older pages', () => {
    queryClient.setQueryData<MessagesData>(queryKeys.messages('c1'), {
      pages: [page('a1'), page('u1')],
      pageParams: [null, 'cursor'],
    });

    insertMessagesInCache(queryClient, 'c1', [makeMessage('u1', 'user'), makeMessage('a2')]);

    expect(cachedIds(queryClient)).toEqual([['a2', 'a1'], ['u1']]);
  });

  it('re-applies the insert once an in-flight fetch lands with stale data', async () => {
    let resolveFetch: (data: PaginatedMessages) => void = () => {};
    const fetching = queryClient.fetchInfiniteQuery({
      queryKey: queryKeys.messages('c1'),
      queryFn: () => new Promise<PaginatedMessages>((resolve) => (resolveFetch = resolve)),
      initialPageParam: null,
    });

    insertMessagesInCache(queryClient, 'c1', [makeMessage('u1', 'user'), makeMessage('a1')]);
    resolveFetch(page('a0'));
    await fetching;
    await Promise.resolve();

    expect(cachedIds(queryClient)).toEqual([['a1', 'u1', 'a0']]);
  });
});

describe('insertStartedTurnInCache', () => {
  const chat = {
    id: 'c1',
    last_model_id: 'old-model',
    last_thinking_mode: 'low',
    last_persona_name: null,
  } as Chat;

  it('stamps the turn settings on the chat and inserts the user/assistant pair', () => {
    queryClient.setQueryData(queryKeys.chat('c1'), chat);
    queryClient.setQueryData<MessagesData>(queryKeys.messages('c1'), {
      pages: [page('a0')],
      pageParams: [null],
    });

    insertStartedTurnInCache(queryClient, {
      kind: 'stream_started',
      chat_id: 'c1',
      message_id: 'a1',
      user_message_id: 'u1',
      content: 'hello',
      attachments: null,
      model_id: 'new-model',
      permission_mode: 'plan',
      checkpoint_id: 'cp1',
    });

    expect(queryClient.getQueryData<Chat>(queryKeys.chat('c1'))).toMatchObject({
      last_model_id: 'new-model',
      last_permission_mode: 'plan',
      last_thinking_mode: 'low',
    });
    const [assistant, user] = queryClient.getQueryData<MessagesData>(queryKeys.messages('c1'))!
      .pages[0].items;
    expect(user).toMatchObject({ id: 'u1', role: 'user', content_text: 'hello', attachments: [] });
    expect(assistant).toMatchObject({
      id: 'a1',
      stream_status: 'in_progress',
      model_id: 'new-model',
      checkpoint_id: 'cp1',
    });
  });
});
