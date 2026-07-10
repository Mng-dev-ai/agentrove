import { describe, it, expect } from 'vitest';
import { extractResultText } from './agentTool';

describe('extractResultText', () => {
  it('returns a non-empty string as-is', () => {
    expect(extractResultText('done')).toBe('done');
  });

  it('maps an empty string to undefined', () => {
    expect(extractResultText('')).toBeUndefined();
  });

  it('joins text blocks with newlines', () => {
    expect(
      extractResultText([
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('a\nb');
  });

  it('ignores non-text blocks when collecting text', () => {
    const result = [
      { type: 'image', source: {} },
      { type: 'text', text: 'keep' },
      { type: 'tool_use', text: 42 },
    ];
    expect(extractResultText(result)).toBe('keep');
  });

  it('returns undefined for an array with no text blocks', () => {
    expect(extractResultText([{ type: 'image' }, { type: 'tool_use' }])).toBeUndefined();
  });

  it('returns undefined for an empty array', () => {
    expect(extractResultText([])).toBeUndefined();
  });

  it('filters blocks whose text is not a string', () => {
    expect(extractResultText([{ type: 'text', text: 123 }])).toBeUndefined();
  });

  it('skips null/non-object array entries', () => {
    expect(extractResultText([null, 'raw', { type: 'text', text: 'ok' }])).toBe('ok');
  });

  it.each([[null], [undefined], [42], [{ type: 'text', text: 'x' }], [true]])(
    'returns undefined for non-string, non-array input: %p',
    (input) => {
      expect(extractResultText(input)).toBeUndefined();
    },
  );

  // Suspicious-but-harmless: a single empty-string text block yields '' (not
  // undefined), unlike the top-level string branch which maps '' to undefined.
  it('returns an empty string for an array holding only an empty text block', () => {
    expect(extractResultText([{ type: 'text', text: '' }])).toBe('');
  });
});
