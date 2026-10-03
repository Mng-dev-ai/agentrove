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
  updated_at: string;
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

export type ChannelMessageStatus = 'streaming' | 'completed' | 'cancelled' | 'deleted';

export interface ChannelMessage {
  id: string;
  channel_id: string;
  seq: number;
  version: number;
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

export type ChannelEnvelope = ChannelEnvelopeBase<'channel_message', { message: ChannelMessage }>;

export function isChannelEnvelope(value: unknown): value is ChannelEnvelope {
  return typeof value === 'object' && value !== null && 'channelId' in value;
}
