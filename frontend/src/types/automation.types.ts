import type { PermissionMode } from '@/store/chatSettingsStore';
import type { ScheduleForm } from '@/utils/automationSchedule';

export interface Automation {
  id: string;
  user_id: string;
  workspace_id: string;
  name: string;
  prompt: string;
  model_id: string;
  cron_expression: string;
  timezone: string;
  permission_mode: PermissionMode;
  thinking_mode: string | null;
  worktree: boolean;
  plan_mode: boolean;
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
  cron_expression: string;
  timezone: string;
  permission_mode: PermissionMode;
  thinking_mode: string | null;
  worktree: boolean;
  plan_mode: boolean;
  selected_persona_name: string;
  enabled: boolean;
}

export type AutomationUpdateRequest = Partial<AutomationCreateRequest>;

// Snapshot of every inputbar setting an automation replays when its schedule
// fires — the edit-dialog form state shared between the tab and the dialog.
export interface AutomationForm {
  name: string;
  prompt: string;
  model_id: string;
  workspace_id: string;
  schedule: ScheduleForm;
  timezone: string;
  permission_mode: PermissionMode;
  thinking_mode: string;
  worktree: boolean;
  plan_mode: boolean;
  persona_name: string;
  onCloud: boolean;
}
