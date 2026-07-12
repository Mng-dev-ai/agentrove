import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat } from '@/types/chat.types';
import { buildRecentChatSections } from './sidebarGrouping';

const NOW = new Date(2026, 6, 12, 12);

function chat(id: string, updatedAt: Date, over: Partial<Chat> = {}): Chat {
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
    ...over,
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

const DAY = new Date(2026, 6, 12, 12);

describe('buildRecentChatSections workspace grouping', () => {
  it('groups by workspace in most-recent order, resolving badge names', () => {
    const sections = buildRecentChatSections({
      groupBy: 'workspace',
      visibleRecentChats: [
        chat('a', DAY, { workspace_id: 'ws-1' }),
        chat('b', DAY, { workspace_id: 'ws-2' }),
        chat('c', DAY, { workspace_id: 'ws-1' }),
      ],
      workspaceBadgeById: new Map([
        ['ws-1', { name: 'Alpha', isCloud: false }],
        ['ws-2', { name: 'Beta', isCloud: true }],
      ]),
      blockedChatIdSet: new Set(),
      streamingChatIdSet: new Set(),
      completedChatIds: new Set(),
    });

    expect(sections.map(({ label, chats }) => [label, chats.map(({ id }) => id)])).toEqual([
      ['Alpha', ['a', 'c']],
      ['Beta', ['b']],
    ]);
  });

  it('falls back to "Unknown workspace" while the badge is unresolved', () => {
    const sections = buildRecentChatSections({
      groupBy: 'workspace',
      visibleRecentChats: [chat('a', DAY, { workspace_id: 'ws-x' })],
      workspaceBadgeById: new Map(),
      blockedChatIdSet: new Set(),
      streamingChatIdSet: new Set(),
      completedChatIds: new Set(),
    });
    expect(sections.map(({ label }) => label)).toEqual(['Unknown workspace']);
  });
});

describe('buildRecentChatSections status grouping', () => {
  it('assigns each chat to its highest-precedence status group and orders by urgency', () => {
    const sections = buildRecentChatSections({
      groupBy: 'status',
      visibleRecentChats: [
        chat('plain', DAY),
        chat('unread', DAY, { unread: true }),
        chat('done', DAY),
        chat('running', DAY),
        chat('blocked', DAY),
        // blocked wins over streaming/completed/unread precedence
        chat('blocked-and-streaming', DAY, { unread: true }),
      ],
      workspaceBadgeById: new Map(),
      blockedChatIdSet: new Set(['blocked', 'blocked-and-streaming']),
      streamingChatIdSet: new Set(['running', 'blocked-and-streaming']),
      completedChatIds: new Set(['done']),
    });

    expect(sections.map(({ label, chats }) => [label, chats.map(({ id }) => id)])).toEqual([
      ['Needs you', ['blocked', 'blocked-and-streaming']],
      ['Running', ['running']],
      ['Done', ['done']],
      ['Unread', ['unread']],
      ['Other', ['plain']],
    ]);
  });

  it('omits status groups that have no chats', () => {
    const sections = buildRecentChatSections({
      groupBy: 'status',
      visibleRecentChats: [chat('only', DAY, { unread: true })],
      workspaceBadgeById: new Map(),
      blockedChatIdSet: new Set(),
      streamingChatIdSet: new Set(),
      completedChatIds: new Set(),
    });
    expect(sections.map(({ label }) => label)).toEqual(['Unread']);
  });
});

describe('buildRecentChatSections ungrouped', () => {
  it('returns a single headerless section preserving order', () => {
    const chats = [chat('a', DAY), chat('b', DAY)];
    const sections = buildRecentChatSections({
      groupBy: 'none',
      visibleRecentChats: chats,
      workspaceBadgeById: new Map(),
      blockedChatIdSet: new Set(),
      streamingChatIdSet: new Set(),
      completedChatIds: new Set(),
    });
    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBeNull();
    expect(sections[0].chats.map(({ id }) => id)).toEqual(['a', 'b']);
  });
});
