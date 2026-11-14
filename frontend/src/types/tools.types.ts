export type ToolEventStatus = 'started' | 'completed' | 'failed';

export interface ToolEventPayload {
  id: string;
  name: string;
  title: string;
  status: ToolEventStatus;
  parent_id?: string | null;
  input?: Record<string, unknown> | null;
  path?: string;
  result?: unknown;
  error?: string;
  permission_mode?: string | null;
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
  error?: string;
  children: ToolAggregate[];
}
