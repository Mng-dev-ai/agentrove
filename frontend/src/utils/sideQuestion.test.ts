// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { Chat, Model } from '@/types/chat.types';
import { canAskSideQuestion, sideQuestionIntent } from './sideQuestion';

const sonnet: Model = {
  model_id: 'sonnet',
  name: 'Sonnet',
  agent_kind: 'claude',
  context_window: null,
  thinking_modes: [],
  supports_fork: true,
};
const copilot: Model = {
  model_id: 'copilot:gpt',
  name: 'GPT',
  agent_kind: 'copilot',
  context_window: null,
  thinking_modes: [],
};
const models = new Map([sonnet, copilot].map((model) => [model.model_id, model]));

const claudeChat = {
  id: 'chat-1',
  parent_chat_id: null,
  channel_id: null,
  session_agent_kind: 'claude',
  last_model_id: 'sonnet',
} as Chat;
const copilotChat = {
  ...claudeChat,
  session_agent_kind: 'copilot',
  last_model_id: 'copilot:gpt',
} as Chat;

function intentFor(text: string, chat: Chat | undefined) {
  return sideQuestionIntent(text, chat, models.get(chat?.last_model_id ?? ''));
}

describe('sideQuestionIntent', () => {
  it.each([
    ['/btw where is the retry logic?', 'where is the retry logic?'],
    ['  /btw where is the retry logic?', 'where is the retry logic?'],
  ])('asks the question in %j', (text, question) => {
    expect(intentFor(text, claudeChat)).toEqual({
      kind: 'ask',
      chat: claudeChat,
      model: sonnet,
      question,
    });
  });

  it.each(['/btw', '/btw   '])('holds back %j without a question', (text) => {
    expect(intentFor(text, claudeChat)).toEqual({ kind: 'empty' });
  });

  it.each(['/btwx why', 'why /btw', 'plain message'])('leaves %j to the agent', (text) => {
    expect(intentFor(text, claudeChat)).toBeNull();
  });

  it("follows the chat's last model, not a non-fork model picked in the composer", () => {
    expect(intentFor('/btw why', claudeChat)).toMatchObject({ kind: 'ask', model: sonnet });
  });

  it("refuses a chat whose last model can't fork, whatever the composer picked", () => {
    expect(intentFor('/btw why', copilotChat)).toEqual({
      kind: 'refuse',
      message: "Side questions aren't available for Copilot yet.",
    });
  });

  it('refuses inside a sub-thread', () => {
    expect(intentFor('/btw why', { ...claudeChat, parent_chat_id: 'parent-1' })).toEqual({
      kind: 'refuse',
      message: "Side questions aren't available inside a sub-thread.",
    });
  });
});

describe('canAskSideQuestion', () => {
  it.each([
    ['a top-level chat that last ran on a fork-capable model', claudeChat, true],
    ['the landing composer, which has no chat', undefined, false],
    ['a sub-thread', { ...claudeChat, parent_chat_id: 'parent-1' }, false],
    ["a chat whose last model can't fork", copilotChat, false],
    ['a chat with no finished turn', { ...claudeChat, session_agent_kind: null }, false],
  ])('offers /btw in %s: %s', (_label, chat, offered) => {
    expect(canAskSideQuestion(chat, models.get(chat?.last_model_id ?? ''))).toBe(offered);
  });
});
