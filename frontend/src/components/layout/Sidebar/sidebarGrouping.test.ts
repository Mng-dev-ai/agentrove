import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat } from '@/types/chat.types';
import { buildRecentChatSections } from './sidebarGrouping';

const NOW = new Date(2026, 6, 12, 12);

function chat(id: string, updatedAt: Date): Chat {
  return {
    id,
    user_id: 'user',
    title: id,
    workspace_id: 'workspace',
    sandbox_id: 'sandbox',
    created_at: updatedAt.toISOString(),
    updated_at: updatedAt.toISOString(),
    pinned_at: null,
    worktree_cwd: null,
    parent_chat_id: null,
    sub_thread_count: 0,
    session_agent_kind: null,
    unread: false,
  };
}

function groupByDate(chats: Chat[]) {
  return buildRecentChatSections({
    groupBy: 'date',
    visibleRecentChats: chats,
    workspaceBadgeById: new Map(),
    blockedChatIdSet: new Set(),
    streamingChatIdSet: new Set(),
    completedChatIds: new Set(),
  });
}

describe('buildRecentChatSections date grouping', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => vi.useRealTimers());

  it('groups chats by local calendar day across the today and yesterday boundary', () => {
    const sections = groupByDate([
      chat('today-late', new Date(2026, 6, 12, 23, 59)),
      chat('today-early', new Date(2026, 6, 12, 0, 1)),
      chat('yesterday', new Date(2026, 6, 11, 23, 59)),
    ]);

    expect(sections.map(({ label, chats }) => [label, chats.map(({ id }) => id)])).toEqual([
      ['Today', ['today-late', 'today-early']],
      ['Yesterday', ['yesterday']],
    ]);
  });

  it('formats older dates and preserves the incoming recency order', () => {
    const sameYear = new Date(2026, 5, 30, 12);
    const priorYear = new Date(2025, 11, 31, 12);
    const sections = groupByDate([
      chat('same-year-newer', new Date(2026, 5, 30, 18)),
      chat('same-year-older', sameYear),
      chat('prior-year', priorYear),
    ]);

    expect(sections.map(({ label, chats }) => [label, chats.map(({ id }) => id)])).toEqual([
      [
        new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(sameYear),
        ['same-year-newer', 'same-year-older'],
      ],
      [
        new Intl.DateTimeFormat(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }).format(priorYear),
        ['prior-year'],
      ],
    ]);
  });
});
