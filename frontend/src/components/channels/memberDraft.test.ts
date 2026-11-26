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
import {
  channelMentionHandles,
  memberRequest,
  newMemberDraft,
  resolveMemberNames,
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
