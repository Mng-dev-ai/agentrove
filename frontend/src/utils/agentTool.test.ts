import { describe, it, expect } from 'vitest';
import { extractResultText } from './agentTool';

describe('extractResultText', () => {
  it('returns a non-empty string as-is', () => {
    expect(extractResultText('done')).toBe('done');
  });

  it('joins only well-formed text blocks with newlines', () => {
    const result = [
      { type: 'text', text: 'a' },
      { type: 'image', source: {} },
      null,
      'raw',
      { type: 'tool_use', text: 42 },
      { type: 'text', text: 'b' },
    ];
    expect(extractResultText(result)).toBe('a\nb');
  });

  it.each([
    ['an empty string', ''],
    ['an empty array', []],
    ['an array without text blocks', [{ type: 'image' }, { type: 'text', text: 123 }]],
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a lone text block object', { type: 'text', text: 'x' }],
  ])('returns undefined for %s', (_label, input) => {
    expect(extractResultText(input)).toBeUndefined();
  });
});
