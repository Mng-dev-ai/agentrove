import type { PermissionMode } from '@/store/chatSettingsStore';
import type { MessageAttachment, ToolPermissionRequest } from '@/types/chat.types';

export interface ChannelMember {
  id: string;
  chat_id: string;
  model_id: string;
  display_name: string;
  persona: string | null;
  thinking_mode: string | null;
  permission_mode: PermissionMode;
}

export interface Channel {
  id: string;
  workspace_id: string;
  name: string;
  worktree: boolean;
  branch: string | null;
  created_at: string;
  updated_at: string;
  members: ChannelMember[];
}

export interface ChannelMemberCreateRequest {
  model_id: string;
  persona?: string | null;
  thinking_mode?: string | null;
  permission_mode?: PermissionMode;
  display_name?: string;
}

export interface ChannelCreateRequest {
  workspace_id: string;
  name: string;
  worktree: boolean;
  branch: string | null;
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
  attachments: MessageAttachment[];
  tool_call_count: number;
  duration_ms: number | null;
  created_at: string;
}

export interface ChannelPermissionRequest {
  member_id: string;
  chat_id: string;
  request: ToolPermissionRequest;
}

export interface ChannelMemberActivity {
  epoch: string;
  version: number;
  member_ids: string[];
}

interface ChannelEnvelopeBase<K extends string, P> {
  channelId: string;
  kind: K;
  payload: P;
}

export type ChannelEnvelope =
  | ChannelEnvelopeBase<'channel_message', { message: ChannelMessage }>
  | ChannelEnvelopeBase<'channel_permission_request', ChannelPermissionRequest>
  | ChannelEnvelopeBase<'channel_permission_resolved', { member_id: string; request_id: string }>
  | ChannelEnvelopeBase<'channel_member_activity', ChannelMemberActivity>;

export function isChannelEnvelope(value: unknown): value is ChannelEnvelope {
  return typeof value === 'object' && value !== null && 'channelId' in value;
}
