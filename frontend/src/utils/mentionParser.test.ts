import { describe, it, expect } from 'vitest';
import {
  parseTokenQuery,
  insertToken,
  getHighlightTokenRanges,
  buildHighlightSegments,
} from './mentionParser';

describe('parseTokenQuery', () => {
  it('is inactive when the trigger is absent before the cursor', () => {
    expect(parseTokenQuery('hello', 5, '@')).toEqual({
      isActive: false,
      query: '',
      tokenStartPos: -1,
      tokenEndPos: -1,
    });
  });

  it('activates for a trigger at the start of the message', () => {
    expect(parseTokenQuery('@foo', 4, '@')).toEqual({
      isActive: true,
      query: 'foo',
      tokenStartPos: 0,
      tokenEndPos: 4,
    });
  });

  it('activates for a trigger preceded by a space', () => {
    const r = parseTokenQuery('hi @foo', 7, '@');
    expect(r.isActive).toBe(true);
    expect(r.query).toBe('foo');
    expect(r.tokenStartPos).toBe(3);
    expect(r.tokenEndPos).toBe(7);
  });

  it('activates for a trigger preceded by a newline', () => {
    expect(parseTokenQuery('hi\n@foo', 7, '@').isActive).toBe(true);
  });

  it('lowercases the query', () => {
    expect(parseTokenQuery('@FooBar', 7, '@').query).toBe('foobar');
  });

  it('is inactive when the trigger sits mid-word (e.g. an email)', () => {
    expect(parseTokenQuery('user@host', 9, '@').isActive).toBe(false);
  });

  it('is inactive when whitespace separates the trigger from the cursor', () => {
    expect(parseTokenQuery('@foo bar', 8, '@').isActive).toBe(false);
  });

  it('is inactive when a newline separates the trigger from the cursor', () => {
    expect(parseTokenQuery('@foo\nbar', 8, '@').isActive).toBe(false);
  });

  it('only inspects text before the cursor', () => {
    // The '@' is after the cursor, so it is invisible to the parser.
    expect(parseTokenQuery('a @foo', 1, '@').isActive).toBe(false);
  });

  it('anchors on the last trigger, so an invalid last trigger wins over an earlier valid one', () => {
    // Earlier '@a' is valid, but the parser looks only at the last '@' (in b@c).
    expect(parseTokenQuery('@a b@c', 6, '@').isActive).toBe(false);
  });

  it('uses the last valid trigger when several are present', () => {
    const r = parseTokenQuery('@a @b', 5, '@');
    expect(r.isActive).toBe(true);
    expect(r.query).toBe('b');
    expect(r.tokenStartPos).toBe(3);
  });

  it('supports the slash trigger', () => {
    expect(parseTokenQuery('/hel', 4, '/')).toEqual({
      isActive: true,
      query: 'hel',
      tokenStartPos: 0,
      tokenEndPos: 4,
    });
  });

  it('reports an empty query for a bare trigger at the cursor', () => {
    const r = parseTokenQuery('@', 1, '@');
    expect(r.isActive).toBe(true);
    expect(r.query).toBe('');
  });
});

describe('insertToken', () => {
  it('replaces the in-progress token and appends a closing space', () => {
    // "@fo|" -> pick "@foo.ts"
    const r = insertToken('@fo', '@foo.ts', 0, 3);
    expect(r.text).toBe('@foo.ts ');
    expect(r.cursor).toBe(8);
  });

  it('does not add a separator when the following text already starts with a space', () => {
    const r = insertToken('@fo rest', '@foo', 0, 3);
    expect(r.text).toBe('@foo rest');
    expect(r.cursor).toBe(4);
  });

  it('replaces a token embedded in surrounding text', () => {
    const r = insertToken('say @fo now', '@foo', 4, 7);
    expect(r.text).toBe('say @foo now');
    // The existing space after the token means no separator is added, so the
    // cursor lands right after the inserted token.
    expect(r.cursor).toBe(8);
  });
});

describe('getHighlightTokenRanges', () => {
  it('returns no ranges for empty or token-free text', () => {
    expect(getHighlightTokenRanges('')).toEqual([]);
    expect(getHighlightTokenRanges('just words')).toEqual([]);
  });

  it('captures a mention at the start of the string', () => {
    expect(getHighlightTokenRanges('@foo bar')).toEqual([[0, 4]]);
  });

  it('captures a command after a space', () => {
    expect(getHighlightTokenRanges('run /cmd')).toEqual([[4, 8]]);
  });

  it('captures multiple tokens without including the leading whitespace', () => {
    expect(getHighlightTokenRanges('a @b @c')).toEqual([
      [2, 4],
      [5, 7],
    ]);
  });

  it('ignores a trigger that is not at a word boundary', () => {
    expect(getHighlightTokenRanges('a@b')).toEqual([]);
  });
});

describe('buildHighlightSegments', () => {
  it('returns an empty array for an empty message', () => {
    expect(buildHighlightSegments('')).toEqual([]);
  });

  it('returns a single plain run when there are no tokens', () => {
    expect(buildHighlightSegments('plain text')).toEqual([{ text: 'plain text', isToken: false }]);
  });

  it('marks a lone token run as a token', () => {
    expect(buildHighlightSegments('@foo')).toEqual([{ text: '@foo', isToken: true }]);
  });

  it('splits leading text, token, and trailing text into ordered runs', () => {
    expect(buildHighlightSegments('hi @foo there')).toEqual([
      { text: 'hi ', isToken: false },
      { text: '@foo', isToken: true },
      { text: ' there', isToken: false },
    ]);
  });

  it('interleaves multiple tokens with their separating text', () => {
    expect(buildHighlightSegments('a @b @c')).toEqual([
      { text: 'a ', isToken: false },
      { text: '@b', isToken: true },
      { text: ' ', isToken: false },
      { text: '@c', isToken: true },
    ]);
  });
});
