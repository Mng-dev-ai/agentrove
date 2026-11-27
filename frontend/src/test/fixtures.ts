import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queries/queryKeys';
import type { PaginatedMessages } from '@/types/api.types';
import type { ChannelCompletion, ChannelEnvelope } from '@/types/channel.types';
import type { ChatEvent, Message } from '@/types/chat.types';
import type { StreamEnvelope } from '@/types/stream.types';

type MessagesData = { pages: PaginatedMessages[]; pageParams: unknown[] };
type ChannelPayload<K extends ChannelEnvelope['kind']> = Extract<
  ChannelEnvelope,
  { kind: K }
>['payload'];

export const CHAT_EVENT_KEYS = {
  chat_created: ['kind', 'chat'],
  stream_started: [
    'kind',
    'chat_id',
    'parent_chat_id',
    'message_id',
    'user_message_id',
    'content',
    'app_notice',
    'attachments',
    'model_id',
    'thinking_mode',
    'permission_mode',
    'selected_persona_name',
    'checkpoint_id',
  ],
  title_updated: ['kind', 'chat_id', 'title'],
  channel_created: ['kind', 'channel_id', 'parent_chat_id'],
} satisfies { [K in ChatEvent['kind']]: (keyof Extract<ChatEvent, { kind: K }>)[] };

export const CHANNEL_PAYLOAD_KEYS = {
  channel_message: ['message'],
  channel_permission_request: ['member_id', 'chat_id', 'request'],
  channel_permission_resolved: ['member_id', 'request_id'],
  channel_member_activity: [
    'epoch',
    'version',
    'member_ids',
    'waiting_member_ids',
    'elicitations',
    'retrying_member_ids',
    'member_errors',
    'unavailable_members',
  ],
  channel_queue_sent: ['id'],
} satisfies { [K in ChannelEnvelope['kind']]: (keyof ChannelPayload<K>)[] };

export const CHANNEL_ACTIVITY_NOTICES = [
  'asked',
  'completed',
] satisfies (keyof ChannelPayload<'channel_member_activity'>)[];

export const CHANNEL_NOTICE_KEYS = ['title', 'body'] satisfies (keyof ChannelCompletion)[];

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

// Wire data is unvalidated JSON, so payloads the types rule out still arrive.
export function wireEnvelope(value: unknown): StreamEnvelope {
  return JSON.parse(JSON.stringify(value));
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
