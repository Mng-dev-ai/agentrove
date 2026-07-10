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
    expect(cleared).toEqual({
      statuses: [],
      agentKind: null,
      source: 'all',
      workspaceId: null,
      groupBy: 'workspace',
    });
  });

  it('returns a fresh object, never mutating the input', () => {
    const input = filters({ statuses: ['done'] });
    const cleared = clearSidebarFilters(input);
    expect(cleared).not.toBe(input);
    expect(input.statuses).toEqual(['done']);
  });
});

describe('countActiveSidebarFilters', () => {
  it('counts zero for the empty filter set', () => {
    expect(countActiveSidebarFilters(EMPTY_SIDEBAR_FILTERS)).toBe(0);
  });

  it('adds one per status entry', () => {
    expect(countActiveSidebarFilters(filters({ statuses: ['unread', 'done', 'needs-you'] }))).toBe(
      3,
    );
  });

  it('counts agentKind, non-all source, and workspaceId as one each', () => {
    expect(
      countActiveSidebarFilters(
        filters({ agentKind: 'codex', source: 'cloud', workspaceId: 'ws-1' }),
      ),
    ).toBe(3);
  });

  it('treats source "all" as inactive', () => {
    expect(countActiveSidebarFilters(filters({ source: 'all' }))).toBe(0);
    expect(countActiveSidebarFilters(filters({ source: 'local' }))).toBe(1);
  });

  it('excludes groupBy from the active count (presentation, not a filter)', () => {
    expect(countActiveSidebarFilters(filters({ groupBy: 'status' }))).toBe(0);
  });
});
