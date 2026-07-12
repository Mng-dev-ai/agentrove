import type { AgentKind } from '@/types/chat.types';

// Sidebar chat-list filter model — shared by uiStore (persistence), Sidebar
// (count/clear), and SidebarFilterMenu (UI), so it lives outside the component.

// Status filters mirror the row badge signals: unread is the persisted server flag;
// running/done/needs-you are session-only stream state that resets on reload.
export type SidebarStatusFilter = 'unread' | 'running' | 'done' | 'needs-you';
export type SidebarSourceFilter = 'all' | 'local' | 'cloud';
export type SidebarGroupBy = 'none' | 'date' | 'workspace' | 'status';

// statuses is an array (not a Set) so the whole object survives JSON
// persistence in uiStore; it's at most 4 entries.
export interface SidebarFilters {
  statuses: SidebarStatusFilter[];
  agentKind: AgentKind | null;
  source: SidebarSourceFilter;
  workspaceId: string | null;
  // Presentation mode, not a filter — excluded from countActiveSidebarFilters
  // and preserved when filters are cleared.
  groupBy: SidebarGroupBy;
}

// Never mutated — filter changes always build a fresh object, so sharing one
// instance for the initial and cleared state is safe.
export const EMPTY_SIDEBAR_FILTERS: SidebarFilters = {
  statuses: [],
  agentKind: null,
  source: 'all',
  workspaceId: null,
  groupBy: 'none',
};

// Clearing resets the filter dimensions but keeps presentation (groupBy) —
// the same filter/presentation split countActiveSidebarFilters encodes.
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
