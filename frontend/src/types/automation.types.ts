import type { PermissionMode } from '@/store/chatSettingsStore';
import type { ScheduleForm } from '@/utils/automationSchedule';
import type { ChannelMemberCreateRequest } from '@/types/channel.types';
import type { MemberDraft } from '@/components/channels/memberDraft';

export interface AutomationChannelMember {
  model_id: string;
  display_name: string | null;
  permission_mode: PermissionMode | null;
  persona: string | null;
  thinking_mode: string | null;
}

export interface Automation {
  id: string;
  user_id: string;
  workspace_id: string;
  channel_members?: AutomationChannelMember[] | null;
  name: string;
  prompt: string;
  model_id: string;
  cron_expression: string;
  timezone: string;
  permission_mode: PermissionMode;
  thinking_mode: string | null;
  worktree: boolean;
  selected_persona_name: string;
  enabled: boolean;
  next_run_at: string;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationCreateRequest {
  name: string;
  prompt: string;
  model_id: string;
  workspace_id: string;
  channel_members: ChannelMemberCreateRequest[] | null;
  cron_expression: string;
  timezone: string;
  permission_mode: PermissionMode;
  thinking_mode: string | null;
  worktree: boolean;
  selected_persona_name: string;
  enabled: boolean;
}

export interface AutomationRunResponse {
  chat_id?: string | null;
  channel_id?: string | null;
}

export type AutomationTarget = 'chat' | 'channel';

export type AutomationUpdateRequest = Partial<AutomationCreateRequest>;

// Inputbar settings an automation replays; shared edit-dialog form shape.
export interface AutomationForm {
  name: string;
  prompt: string;
  model_id: string;
  workspace_id: string;
  target: AutomationTarget;
  members: MemberDraft[];
  schedule: ScheduleForm;
  timezone: string;
  permission_mode: PermissionMode;
  thinking_mode: string;
  worktree: boolean;
  persona_name: string;
  machineId: string;
}
