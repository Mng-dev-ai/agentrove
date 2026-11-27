import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/hooks/queries/queryKeys';
import type { PaginatedMessages } from '@/types/api.types';
import type {
  ChannelCompletion,
  ChannelElicitationRequest,
  ChannelEnvelope,
} from '@/types/channel.types';
import type {
  ChatEvent,
  ElicitationRequest,
  Message,
  ToolPermissionRequest,
} from '@/types/chat.types';
import type { StreamEnvelope } from '@/types/stream.types';

type MessagesData = { pages: PaginatedMessages[]; pageParams: unknown[] };
type ChannelPayload<K extends ChannelEnvelope['kind']> = Extract<
  ChannelEnvelope,
  { kind: K }
>['payload'];

export const CHAT_EVENT_KEYS = {
  chat_created: { kind: true, chat: true },
  stream_started: {
    kind: true,
    chat_id: true,
    parent_chat_id: true,
    message_id: true,
    user_message_id: true,
    content: true,
    app_notice: true,
    attachments: true,
    model_id: true,
    thinking_mode: true,
    permission_mode: true,
    selected_persona_name: true,
    checkpoint_id: true,
  },
  title_updated: { kind: true, chat_id: true, title: true },
  channel_created: { kind: true, channel_id: true, parent_chat_id: true },
} satisfies { [K in ChatEvent['kind']]: Record<keyof Extract<ChatEvent, { kind: K }>, true> };

export const CHANNEL_ACTIVITY_NOTICES = { asked: true, completed: true } satisfies Partial<
  Record<keyof ChannelPayload<'channel_member_activity'>, true>
>;

export const CHANNEL_PAYLOAD_KEYS = {
  channel_message: { message: true },
  channel_permission_request: { member_id: true, chat_id: true, request: true },
  channel_permission_resolved: { member_id: true, request_id: true },
  channel_member_activity: {
    epoch: true,
    version: true,
    member_ids: true,
    waiting_member_ids: true,
    elicitations: true,
    retrying_member_ids: true,
    member_errors: true,
    unavailable_members: true,
  },
  channel_queue_sent: { id: true },
} satisfies {
  [K in ChannelEnvelope['kind']]: Record<
    Exclude<keyof ChannelPayload<K>, keyof typeof CHANNEL_ACTIVITY_NOTICES>,
    true
  >;
};

export const CHANNEL_NOTICE_KEYS = { title: true, body: true } satisfies Record<
  keyof ChannelCompletion,
  true
>;

export const TOOL_PERMISSION_REQUEST_KEYS = {
  request_id: true,
  tool_name: true,
  tool_input: true,
  options: true,
} satisfies Record<keyof ToolPermissionRequest, true>;

export const CHANNEL_ELICITATION_KEYS = {
  member_id: true,
  chat_id: true,
  request: true,
} satisfies Record<keyof ChannelElicitationRequest, true>;

export const ELICITATION_REQUEST_KEYS = {
  request_id: true,
  message: true,
  tool_call_id: true,
  requested_schema: true,
} satisfies Record<keyof ElicitationRequest, true>;

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
