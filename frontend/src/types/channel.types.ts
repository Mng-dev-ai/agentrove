export interface ChannelMember {
  id: string;
  model_id: string;
  display_name: string;
  persona: string | null;
  thinking_mode: string | null;
}

export interface Channel {
  id: string;
  workspace_id: string;
  name: string;
  created_at: string;
  last_activity_at: string;
  members: ChannelMember[];
}

export interface ChannelMemberCreateRequest {
  model_id: string;
  persona?: string | null;
  thinking_mode?: string | null;
}

export interface ChannelCreateRequest {
  workspace_id: string;
  name: string;
  members: ChannelMemberCreateRequest[];
}

export type ChannelMessageStatus = 'streaming' | 'completed' | 'cancelled';

export interface ChannelMessage {
  id: string;
  channel_id: string;
  seq: number;
  author_type: 'user' | 'agent';
  member_id: string | null;
  content: string;
  status: ChannelMessageStatus;
  created_at: string;
}

interface ChannelEnvelopeBase<K extends string, P> {
  channelId: string;
  kind: K;
  payload: P;
}

export type ChannelEnvelope =
  | ChannelEnvelopeBase<'channel_message_created', { message: ChannelMessage }>
  | ChannelEnvelopeBase<'channel_message_delta', { message_id: string; delta: string }>
  | ChannelEnvelopeBase<'channel_message_completed', { message: ChannelMessage }>
  | ChannelEnvelopeBase<'channel_message_cancelled', { message_id: string }>
  | ChannelEnvelopeBase<'member_typing', { member_id: string; typing: boolean }>;
