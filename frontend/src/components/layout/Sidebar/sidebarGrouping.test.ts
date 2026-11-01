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
    channel_id: null,
    sub_thread_count: 0,
    session_agent_kind: null,
    unread: false,
    last_model_id: null,
    last_thinking_mode: null,
    last_persona_name: null,
    ...over,
  };
}

type GroupingInput = Parameters<typeof buildRecentChatSections>[0];

function group(
  groupBy: GroupingInput['groupBy'],
  chats: Chat[],
  over: Partial<GroupingInput> = {},
): [string | null, string[]][] {
  return buildRecentChatSections({
    groupBy,
    visibleRecentChats: chats,
    workspaceBadgeById: new Map(),
    blockedChatIdSet: new Set(),
    streamingChatIdSet: new Set(),
    completedChatIds: new Set(),
    ...over,
  }).map(({ label, chats }) => [label, chats.map(({ id }) => id)]);
}

describe('buildRecentChatSections date grouping', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => vi.useRealTimers());

  it('groups chats by local calendar day across the today and yesterday boundary', () => {
    expect(
      group('date', [
        chat('today-late', new Date(2026, 6, 12, 23, 59)),
        chat('today-early', new Date(2026, 6, 12, 0, 1)),
        chat('yesterday', new Date(2026, 6, 11, 23, 59)),
      ]),
    ).toEqual([
      ['Today', ['today-late', 'today-early']],
      ['Yesterday', ['yesterday']],
    ]);
  });

  it('labels older days by date, adding the year only outside the current one', () => {
    const sections = group('date', [
      chat('same-year-newer', new Date(2026, 5, 30, 18)),
      chat('same-year-older', new Date(2026, 5, 30, 12)),
      chat('prior-year', new Date(2025, 11, 31, 12)),
    ]);

    expect(sections.map(([, ids]) => ids)).toEqual([
      ['same-year-newer', 'same-year-older'],
      ['prior-year'],
    ]);
    const [sameYearLabel, priorYearLabel] = sections.map(([label]) => label);
    expect(sameYearLabel).not.toContain('2026');
    expect(priorYearLabel).toContain('2025');
  });
});

describe('buildRecentChatSections workspace grouping', () => {
  it('groups by workspace in most-recent order, resolving badge names', () => {
    expect(
      group(
        'workspace',
        [
          chat('a', NOW, { workspace_id: 'ws-1' }),
          chat('b', NOW, { workspace_id: 'ws-2' }),
          chat('c', NOW, { workspace_id: 'ws-1' }),
        ],
        {
          workspaceBadgeById: new Map([
            ['ws-1', { name: 'Alpha', isCloud: false }],
            ['ws-2', { name: 'Beta', isCloud: true }],
          ]),
        },
      ),
    ).toEqual([
      ['Alpha', ['a', 'c']],
      ['Beta', ['b']],
    ]);
  });

  it('falls back to "Unknown workspace" while the badge is unresolved', () => {
    expect(group('workspace', [chat('a', NOW, { workspace_id: 'ws-x' })])).toEqual([
      ['Unknown workspace', ['a']],
    ]);
  });
});

describe('buildRecentChatSections status grouping', () => {
  it('assigns each chat to its highest-precedence status group and orders by urgency', () => {
    expect(
      group(
        'status',
        [
          chat('plain', NOW),
          chat('unread', NOW, { unread: true }),
          chat('done', NOW),
          chat('running', NOW),
          chat('blocked', NOW),
          chat('blocked-and-streaming', NOW, { unread: true }),
        ],
        {
          blockedChatIdSet: new Set(['blocked', 'blocked-and-streaming']),
          streamingChatIdSet: new Set(['running', 'blocked-and-streaming']),
          completedChatIds: new Set(['done']),
        },
      ),
    ).toEqual([
      ['Needs you', ['blocked', 'blocked-and-streaming']],
      ['Running', ['running']],
      ['Done', ['done']],
      ['Unread', ['unread']],
      ['Other', ['plain']],
    ]);
  });

  it('omits status groups that have no chats', () => {
    expect(group('status', [chat('only', NOW, { unread: true })])).toEqual([['Unread', ['only']]]);
  });
});
