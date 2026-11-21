// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { sideQuestionIntent } from './sideQuestion';

const claudeChat = {
  chatId: 'chat-1',
  inSubThread: false,
  agentKind: 'claude' as const,
  supportsFork: true,
};

describe('sideQuestionIntent', () => {
  it.each([
    ['/btw where is the retry logic?', 'where is the retry logic?'],
    ['  /btw where is the retry logic?', 'where is the retry logic?'],
  ])('asks the question in %j', (text, question) => {
    expect(sideQuestionIntent(text, claudeChat)).toEqual({
      kind: 'ask',
      chatId: 'chat-1',
      question,
    });
  });

  it.each(['/btw', '/btw   '])('holds back %j without a question', (text) => {
    expect(sideQuestionIntent(text, claudeChat)).toEqual({ kind: 'empty' });
  });

  it.each(['/btwx why', 'why /btw', 'plain message'])('leaves %j to the agent', (text) => {
    expect(sideQuestionIntent(text, claudeChat)).toBeNull();
  });

  it('refuses an agent that cannot fork', () => {
    expect(
      sideQuestionIntent('/btw why', { ...claudeChat, agentKind: 'grok', supportsFork: false }),
    ).toEqual({ kind: 'refuse', message: "Side questions aren't available for Grok yet." });
  });

  it('refuses inside a sub-thread', () => {
    expect(sideQuestionIntent('/btw why', { ...claudeChat, inSubThread: true })).toEqual({
      kind: 'refuse',
      message: "Side questions aren't available inside a sub-thread.",
    });
  });
});
