import { describe, it, expect } from 'vitest';
import {
  EMPTY_SIDEBAR_FILTERS,
  clearSidebarFilters,
  countActiveSidebarFilters,
  type SidebarFilters,
} from './sidebarFilters';

const filters = (over: Partial<SidebarFilters> = {}): SidebarFilters => ({
  ...EMPTY_SIDEBAR_FILTERS,
  ...over,
});

describe('clearSidebarFilters', () => {
  it('resets every filter dimension but preserves groupBy', () => {
    const cleared = clearSidebarFilters(
      filters({
        statuses: ['unread', 'running'],
        agentKind: 'claude',
        source: 'local',
        workspaceId: 'ws-1',
        groupBy: 'workspace',
      }),
    );
    expect(cleared).toEqual({ ...EMPTY_SIDEBAR_FILTERS, groupBy: 'workspace' });
  });
});

describe('countActiveSidebarFilters', () => {
  it('counts each status plus agentKind, non-all source, and workspaceId', () => {
    expect(
      countActiveSidebarFilters(
        filters({
          statuses: ['unread', 'done', 'needs-you'],
          agentKind: 'codex',
          source: 'cloud',
          workspaceId: 'ws-1',
        }),
      ),
    ).toBe(6);
  });

  it('treats source "all" and any groupBy as inactive', () => {
    expect(countActiveSidebarFilters(filters({ source: 'all', groupBy: 'status' }))).toBe(0);
  });
});
