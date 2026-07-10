import { describe, it, expect } from 'vitest';
import { fuzzySearch } from './fuzzySearch';

describe('fuzzySearch', () => {
  it('returns an empty array when there are no items', () => {
    expect(fuzzySearch('anything', [], { limit: 5 })).toEqual([]);
  });

  it('returns the first `limit` items when the query is empty', () => {
    expect(fuzzySearch('', ['a', 'b', 'c'], { limit: 2 })).toEqual(['a', 'b']);
  });

  it('treats a whitespace-only query as empty', () => {
    expect(fuzzySearch('   ', ['a', 'b', 'c'], { limit: 2 })).toEqual(['a', 'b']);
  });

  it('treats an undefined query as empty', () => {
    expect(fuzzySearch(undefined, ['a', 'b'], { limit: 5 })).toEqual(['a', 'b']);
  });

  it('ranks the best match first for a string list', () => {
    const result = fuzzySearch('app', ['grape', 'apple', 'banana'], { limit: 10 });
    expect(result[0]).toBe('apple');
    expect(result).not.toContain('banana');
  });

  it('searches by object keys and returns the source objects', () => {
    const items = [{ name: 'apple' }, { name: 'banana' }];
    const result = fuzzySearch('apple', items, { keys: ['name'], limit: 10 });
    expect(result[0]).toEqual({ name: 'apple' });
  });

  it('honors the limit for matched results', () => {
    const result = fuzzySearch('a', ['a', 'ba', 'ca', 'da'], { limit: 2 });
    expect(result).toHaveLength(2);
  });
});
