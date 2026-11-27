// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { rehypeMentionPills } from '@/components/ui/markdown/markdownParsing';
import { DEFAULT_PERMISSION_MODE } from '@/store/chatSettingsStore';
import fixture from '@/test/channelMentions.json';
import type { ChannelMember } from '@/types/channel.types';
import type { Model } from '@/types/chat.types';
import type { Persona } from '@/types/user.types';
import {
  channelMentionHandles,
  clearMemberOverrides,
  groupMemberRequests,
  memberRequest,
  mixedMemberSettings,
  newMemberDraft,
  patchGroupMember,
  promoteSoleMemberOverrides,
  resolveMember,
  resolveMemberNames,
  settingsModel,
  withSupportedOverrides,
  type GroupMember,
  type SharedMemberSettings,
} from './memberDraft';

const MEMBERS: ChannelMember[] = fixture.members.map((display_name, index) => ({
  id: `member-${index}`,
  chat_id: `chat-${index}`,
  model_id: 'sonnet',
  display_name,
  persona: null,
  thinking_mode: null,
  permission_mode: DEFAULT_PERMISSION_MODE,
}));
const PILL_PATTERN = /<span class="mention-pill">([^<]*)<\/span>/g;

function pills(markdown: string): string[] {
  const handles = new Set(channelMentionHandles(MEMBERS).map((name) => name.toLowerCase()));
  const html = renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      { remarkPlugins: [remarkGfm], rehypePlugins: [[rehypeMentionPills, handles]] },
      markdown,
    ),
  );
  return [...html.matchAll(PILL_PATTERN)].map((match) => match[1]);
}

// backend/tests/test_channel_mentions_fixture.py holds the same file to the backend
// and the MCP server.
describe('channel member names and mentions match the backend', () => {
  it.each(fixture.names.valid)('accepts the name %j trimmed', (name) => {
    const draft = { ...newMemberDraft(), customName: name };

    expect(resolveMemberNames([draft], [])).toEqual([{ name: name.trim(), error: null }]);
  });

  it.each(fixture.names.invalid)('rejects or never sends the name %j', (name) => {
    const draft = { ...newMemberDraft(), customName: name };
    const [{ error }] = resolveMemberNames([draft], []);

    expect(error === null ? memberRequest(draft, [], []).display_name : undefined).toBeUndefined();
  });

  it('offers every member and every broadcast word as a mention handle', () => {
    expect(channelMentionHandles(MEMBERS)).toEqual([...fixture.members, ...fixture.broadcastWords]);
  });

  it.each(fixture.mentions)('pills $text', ({ text, pills: expected }) => {
    expect(pills(text)).toEqual(expected);
  });
});

describe('group thread members', () => {
  const models: Model[] = [
    {
      model_id: 'claude:opus',
      name: 'Opus',
      agent_kind: 'claude',
      context_window: null,
      thinking_modes: ['low', 'high'],
    },
    {
      model_id: 'cursor:auto',
      name: 'Auto',
      agent_kind: 'cursor',
      context_window: null,
      thinking_modes: [],
    },
  ];
  const personas: Persona[] = [{ name: 'Reviewer', content: 'Review carefully.' }];
  const shared: SharedMemberSettings = {
    thinkingMode: 'high',
    persona: 'Reviewer',
    permissionMode: 'plan',
  };
  const member = (key: string, modelId: string, over: Partial<GroupMember> = {}): GroupMember => ({
    key,
    modelId,
    customName: null,
    overrides: {},
    ...over,
  });

  it('applies the shared settings to every member, coerced per model, with overrides on top', () => {
    const members = [
      member('a', 'claude:opus'),
      member('b', 'claude:opus', { overrides: { thinkingMode: 'low' } }),
      member('c', 'cursor:auto', { customName: 'scout' }),
    ];
    const { requests, names } = groupMemberRequests(members, shared, models, personas);

    expect(names.map(({ name }) => name)).toEqual(['opus', 'opus-2', 'scout']);
    expect(requests).toEqual([
      {
        model_id: 'claude:opus',
        persona: 'Reviewer',
        thinking_mode: 'high',
        permission_mode: 'plan',
        display_name: undefined,
      },
      {
        model_id: 'claude:opus',
        persona: 'Reviewer',
        thinking_mode: 'low',
        permission_mode: 'plan',
        display_name: undefined,
      },
      {
        model_id: 'cursor:auto',
        persona: memberRequest(
          { ...newMemberDraft(), modelId: 'cursor:auto', persona: 'Reviewer' },
          models,
          personas,
        ).persona,
        thinking_mode: null,
        permission_mode: memberRequest(
          { ...newMemberDraft(), modelId: 'cursor:auto', permissionMode: 'plan' },
          models,
          personas,
        ).permission_mode,
        display_name: 'scout',
      },
    ]);
  });

  it('reads a setting as mixed only while an override differs from the shared value', () => {
    expect(
      mixedMemberSettings(
        [
          member('a', 'claude:opus', { overrides: { thinkingMode: 'low', persona: 'Reviewer' } }),
          member('b', 'claude:opus'),
        ],
        shared,
      ),
    ).toEqual({ thinkingMode: true, persona: false, permissionMode: false });
  });

  it('promotes nothing while several members remain', () => {
    const members = [
      member('a', 'claude:opus', { overrides: { thinkingMode: 'low' } }),
      member('b', 'claude:opus'),
    ];

    expect(promoteSoleMemberOverrides(members, models)).toEqual({ members, promoted: {} });
  });

  it("promotes exactly a sole member's overrides and clears them", () => {
    expect(
      promoteSoleMemberOverrides(
        [
          member('a', 'claude:opus', {
            overrides: { permissionMode: 'default', thinkingMode: 'low' },
          }),
        ],
        models,
      ),
    ).toEqual({
      members: [member('a', 'claude:opus')],
      promoted: { permissionMode: 'default', thinkingMode: 'low' },
    });
  });

  it('promotes nothing for a sole member without overrides', () => {
    expect(promoteSoleMemberOverrides([member('a', 'claude:opus')], models)).toEqual({
      members: [member('a', 'claude:opus')],
      promoted: {},
    });
  });

  it('resolves an unlisted channel member as it is sent, and keeps an unlisted chat model', () => {
    const resolved = resolveMember({ modelId: 'claude:gone' }, models);

    expect(settingsModel('claude:gone', models, true)).toEqual({
      agentKind: resolved.agentKind,
      model: resolved.model,
    });
    expect(resolved.model?.model_id).toBe('claude:opus');
    expect(settingsModel('cursor:gone', models, false)).toEqual({
      agentKind: 'cursor',
      model: undefined,
    });
  });

  it('keeps every override while the model list is still loading', () => {
    const overrides = { thinkingMode: 'low', persona: 'Reviewer' };
    const members = [
      member('a', 'cursor:auto', { overrides }),
      member('b', 'claude:opus', { overrides }),
    ];

    expect(withSupportedOverrides(members, [])).toEqual(members);
    expect(promoteSoleMemberOverrides([members[0]], []).promoted).toEqual(overrides);
  });

  it('drops effort and persona overrides a listed model lacks', () => {
    const overrides = { thinkingMode: 'low', persona: 'Reviewer' };

    expect(withSupportedOverrides([member('a', 'cursor:auto', { overrides })], models)).toEqual([
      member('a', 'cursor:auto'),
    ]);
    expect(
      promoteSoleMemberOverrides([member('a', 'cursor:auto', { overrides })], models).promoted,
    ).toEqual({});
  });

  it('routes popover edits to name, model or overrides and clears one setting for all', () => {
    const edited = patchGroupMember(member('a', 'claude:opus'), {
      customName: 'lead',
      modelId: 'cursor:auto',
      permissionMode: 'default',
    });
    expect(edited).toEqual(
      member('a', 'cursor:auto', { customName: 'lead', overrides: { permissionMode: 'default' } }),
    );
    expect(
      clearMemberOverrides([edited, member('b', 'claude:opus')], 'permissionMode').map(
        ({ overrides }) => overrides,
      ),
    ).toEqual([{}, {}]);
  });
});
