import type { PermissionMode } from '@/store/chatSettingsStore';

export interface QueueMessageAttachment {
  file_url: string;
  file_path?: string;
  file_type: string;
  filename?: string;
}

export interface QueuedMessage {
  id: string;
  content: string;
  model_id: string;
  permission_mode: PermissionMode;
  thinking_mode?: string | null;
  worktree: boolean;
  selected_persona_name: string;
  queued_at: string;
  attachments?: QueueMessageAttachment[];
}

export interface QueueAddResponse {
  id: string;
}

export interface LocalQueuedMessage {
  id: string;
  content: string;
  model_id: string;
  files?: File[];
  attachments?: QueueMessageAttachment[];
  permissionMode?: PermissionMode;
  thinkingMode?: string | null;
  worktree?: boolean;
  selectedPersonaName?: string;
  queuedAt: number;
  synced: boolean;
  sendingNow: boolean;
}
