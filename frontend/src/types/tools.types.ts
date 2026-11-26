import type { PermissionMode } from '@/store/chatSettingsStore';

export type ToolEventStatus = 'started' | 'completed' | 'failed';

export interface ToolImage {
  mime_type: string;
  data: string;
}

export interface ToolEventPayload {
  id: string;
  name: string;
  title: string;
  status: ToolEventStatus;
  parent_id?: string | null;
  input?: Record<string, unknown> | null;
  path?: string;
  result?: unknown;
  images?: ToolImage[];
  error?: string;
  permission_mode?: PermissionMode | null;
}

export interface ToolAggregate {
  id: string;
  name: string;
  title: string;
  status: ToolEventStatus;
  parentId?: string | null;
  input?: Record<string, unknown> | null;
  path?: string;
  result?: unknown;
  images?: ToolImage[];
  error?: string;
  children: ToolAggregate[];
}
