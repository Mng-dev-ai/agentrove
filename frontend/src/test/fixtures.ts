import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queries/queryKeys';
import type { PaginatedMessages } from '@/types/api.types';
import type { Message } from '@/types/chat.types';

type MessagesData = { pages: PaginatedMessages[]; pageParams: unknown[] };

export function makeMessage(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    chat_id: 'c1',
    role: 'assistant',
    content_text: '',
    content_render: { events: [] },
    last_seq: 0,
    active_stream_id: null,
    stream_status: 'in_progress',
    created_at: '2024-01-01T00:00:00Z',
    model_id: null,
    duration_ms: null,
    attachments: [],
    checkpoint_id: null,
    tool_results_omitted: false,
    ...overrides,
  };
}

export function seedMessagePages(queryClient: QueryClient, chatId: string, pages: Message[][]) {
  queryClient.setQueryData<MessagesData>(queryKeys.messages(chatId), {
    pages: pages.map((items) => ({ items, next_cursor: null, has_more: false })),
    pageParams: pages.map((_, i) => (i === 0 ? null : `cursor-${i}`)),
  });
}

export function readMessagePages(
  queryClient: QueryClient,
  chatId: string,
): Message[][] | undefined {
  return queryClient
    .getQueryData<MessagesData>(queryKeys.messages(chatId))
    ?.pages.map((page) => page.items);
}
