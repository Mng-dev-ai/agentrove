import { describe, it, expect } from 'vitest';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import { rehypeMentionPills } from './markdownParsing';

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
