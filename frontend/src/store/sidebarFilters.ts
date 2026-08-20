import type { AgentKind } from '@/types/chat.types';

// Shared filter model for uiStore, Sidebar, and SidebarFilterMenu.

// unread is server-persisted; running/done/needs-you are session-only stream state.
export type SidebarStatusFilter = 'unread' | 'running' | 'done' | 'needs-you';
export type SidebarSourceFilter = 'all' | 'local' | 'cloud';
export type SidebarGroupBy = 'none' | 'date' | 'workspace' | 'status';
export type FilterCategory = 'status' | 'agent' | 'source' | 'workspace' | 'groupBy';

export const STATUS_OPTIONS: { value: SidebarStatusFilter; label: string }[] = [
  { value: 'unread', label: 'Unread' },
  { value: 'running', label: 'Running' },
  { value: 'done', label: 'Done' },
  { value: 'needs-you', label: 'Needs you' },
];

export const AGENT_OPTIONS: { value: AgentKind; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'copilot', label: 'Copilot' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'grok', label: 'Grok' },
  { value: 'opencode', label: 'OpenCode' },
];

export const GROUP_BY_OPTIONS: { value: SidebarGroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'date', label: 'Date' },
  { value: 'workspace', label: 'Workspace' },
  { value: 'status', label: 'Status' },
];

// Array (not Set) so the object survives JSON persistence; max 4 entries.
export interface SidebarFilters {
  statuses: SidebarStatusFilter[];
  agentKind: AgentKind | null;
  source: SidebarSourceFilter;
  workspaceId: string | null;
  // Presentation only — excluded from active count, kept on clear.
  groupBy: SidebarGroupBy;
}

// Immutable empty — filter changes always allocate a fresh object.
export const EMPTY_SIDEBAR_FILTERS: SidebarFilters = {
  statuses: [],
  agentKind: null,
  source: 'all',
  workspaceId: null,
  groupBy: 'none',
};

// Resets filter dimensions but keeps presentation (groupBy).
export function clearSidebarFilters(filters: SidebarFilters): SidebarFilters {
  return { ...EMPTY_SIDEBAR_FILTERS, groupBy: filters.groupBy };
}

export function countActiveSidebarFilters(filters: SidebarFilters): number {
  return (
    filters.statuses.length +
    (filters.agentKind ? 1 : 0) +
    (filters.source !== 'all' ? 1 : 0) +
    (filters.workspaceId ? 1 : 0)
  );
}
