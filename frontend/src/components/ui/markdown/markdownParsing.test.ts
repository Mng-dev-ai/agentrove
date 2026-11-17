import { describe, it, expect } from 'vitest';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import { rehypeMentionPills, splitMarkdownBlocks } from './markdownParsing';

const HANDLES: ReadonlySet<string> = new Set(['rev', 'reviewer', 'all']);

function pillTexts(node: HastRoot | HastElement): string[] {
  return node.children.flatMap((child) => {
    if (child.type !== 'element') return [];
    if (child.properties.className !== 'mention-pill') return pillTexts(child);
    return [child.children.map((c) => (c.type === 'text' ? c.value : '')).join('')];
  });
}

function pills(children: HastElement['children']): string[] {
  const tree: HastRoot = {
    type: 'root',
    children: [{ type: 'element', tagName: 'p', properties: {}, children }],
  };
  rehypeMentionPills(HANDLES)(tree);
  return pillTexts(tree);
}

const text = (value: string) => [{ type: 'text' as const, value }];

describe('rehypeMentionPills with channel member handles', () => {
  it('leaves punctuation-only mentions alone', () => {
    expect(pills(text('see @. and @... or @: and @?!'))).toEqual([]);
  });

  it('strips trailing punctuation from a member handle', () => {
    expect(pills(text('thanks @rev, then @reviewer.'))).toEqual(['@rev', '@reviewer']);
  });

  it('matches the exact handle when one is a prefix of another', () => {
    expect(pills(text('@reviewer and @rev'))).toEqual(['@reviewer', '@rev']);
  });

  it('matches case-insensitively and keeps the original casing', () => {
    expect(pills(text('@ReViewer: @ALL!'))).toEqual(['@ReViewer', '@ALL']);
  });

  it('ignores non-members and code spans', () => {
    expect(
      pills([
        ...text('@stranger and '),
        {
          type: 'element',
          tagName: 'code',
          properties: {},
          children: text('@rev'),
        },
      ]),
    ).toEqual([]);
  });
});

describe('splitMarkdownBlocks fences', () => {
  it.each([
    ['a longer math fence', '$$$\nx\n\ny\n$$$'],
    ['a math fence with meta', '$$ tex\nx\n\ny\n$$'],
    ['a math fence with an over-indented closer', '$$\nx\n\n    $$\ny\n\nz\n$$'],
    ['a code fence with an over-indented closer', '```\na\n\n    ```\nb\n\nc\n```'],
    ['a code fence after an indented-code opener', '    ```\na\n```\nx\n\ny\n```'],
    ['a code fence after a tab-indented opener', '\t```\na\n```\nx\n\ny\n```'],
  ])('keeps %s in one block', (_, fenced) => {
    expect(splitMarkdownBlocks(`${fenced}\n\nafter`)).toEqual([fenced, 'after']);
  });

  it('splits at a blank line after a backtick line whose info string has a backtick', () => {
    expect(splitMarkdownBlocks('``` a`b\nx\n\ny')).toEqual(['``` a`b\nx', 'y']);
  });

  it('splits between ordinary math and code fences', () => {
    expect(splitMarkdownBlocks('$$\nx\n$$\n\ntext\n\n```js\na\n\nb\n```\n\nend')).toEqual([
      '$$\nx\n$$',
      'text',
      '```js\na\n\nb\n```',
      'end',
    ]);
  });
});
