// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, ChannelMemberActivity } from '@/types/channel.types';
import type { Chat } from '@/types/chat.types';
import {
  buildRecentChatSections,
  partitionLinkedChannels,
  type MachineChannel,
} from './sidebarGrouping';
import { channelActivityKind } from './useSidebarActivity';

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

function memberActivity(over: Partial<ChannelMemberActivity> = {}): ChannelMemberActivity {
  return {
    epoch: 'epoch',
    version: 1,
    member_ids: [],
    waiting_member_ids: [],
    retrying_member_ids: [],
    ...over,
  };
}

function machineChannel(
  id: string,
  machineId: string,
  parentChatId: string | null | undefined,
): MachineChannel {
  const channel: Channel = {
    id,
    workspace_id: 'workspace',
    name: id,
    worktree: false,
    branch: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    members: [],
    anchor_chat_id: `${id}-anchor`,
    activity: memberActivity(),
  };
  if (parentChatId !== undefined) channel.parent_chat_id = parentChatId;
  return { channel, machineId };
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
            ['ws-1', { name: 'Alpha', machineId: 'local' }],
            ['ws-2', { name: 'Beta', machineId: 'vps' }],
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
          chat('running-and-unread', NOW, { unread: true }),
        ],
        {
          streamingChatIdSet: new Set(['running', 'running-and-unread']),
          completedChatIds: new Set(['done']),
        },
      ),
    ).toEqual([
      ['Running', ['running', 'running-and-unread']],
      ['Done', ['done']],
      ['Unread', ['unread']],
      ['Other', ['plain']],
    ]);
  });

  it('omits status groups that have no chats', () => {
    expect(group('status', [chat('only', NOW, { unread: true })])).toEqual([['Unread', ['only']]]);
  });
});

describe('partitionLinkedChannels', () => {
  it('nests a channel only under a rendered parent on its own machine', () => {
    const { linkedByParentId, topLevel } = partitionLinkedChannels(
      [
        machineChannel('nested', 'local', 'parent'),
        machineChannel('other-machine', 'vps', 'parent'),
        machineChannel('parent-not-rendered', 'local', 'hidden-parent'),
      ],
      new Map([['parent', 'local']]),
    );

    expect(
      [...linkedByParentId].map(([parentId, linked]) => [
        parentId,
        linked.map(({ channel }) => channel.id),
      ]),
    ).toEqual([['parent', ['nested']]]);
    expect(topLevel.map(({ channel }) => channel.id)).toEqual([
      'other-machine',
      'parent-not-rendered',
    ]);
  });

  it('keeps channels without a parent chat id top-level, absent or null', () => {
    const { linkedByParentId, topLevel } = partitionLinkedChannels(
      [
        machineChannel('older-backend', 'local', undefined),
        machineChannel('unlinked', 'local', null),
      ],
      new Map([['parent', 'local']]),
    );

    expect(linkedByParentId.size).toBe(0);
    expect(topLevel.map(({ channel }) => channel.id)).toEqual(['older-backend', 'unlinked']);
  });
});

describe('channelActivityKind', () => {
  it('counts a channel with running and waiting members once, as needs-you', () => {
    expect(
      channelActivityKind(memberActivity({ member_ids: ['a'], waiting_member_ids: ['b'] })),
    ).toBe('needs-you');
  });

  it('counts running members as running and an idle channel as nothing', () => {
    expect(channelActivityKind(memberActivity({ member_ids: ['a'] }))).toBe('running');
    expect(channelActivityKind(memberActivity())).toBeNull();
  });
});
