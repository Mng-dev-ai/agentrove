import { describe, it, expect } from 'vitest';
import { fuzzySearch } from './fuzzySearch';

describe('fuzzySearch', () => {
  it('returns an empty array when there are no items', () => {
    expect(fuzzySearch('anything', [], { limit: 5 })).toEqual([]);
  });

  it.each([[''], ['   '], [undefined]])(
    'returns the first `limit` items unfiltered for blank query %j',
    (query) => {
      expect(fuzzySearch(query, ['a', 'b', 'c'], { limit: 2 })).toEqual(['a', 'b']);
    },
  );

  it('ranks and filters a string list, returning the strings', () => {
    const result = fuzzySearch('app', ['grape', 'apple', 'banana'], { limit: 10 });
    expect(result[0]).toBe('apple');
    expect(result).not.toContain('banana');
  });

  it('searches by object keys and returns the source objects', () => {
    const apple = { name: 'apple' };
    const result = fuzzySearch('apple', [{ name: 'banana' }, apple], { keys: ['name'], limit: 10 });
    expect(result).toEqual([apple]);
    expect(result[0]).toBe(apple);
  });

  it('honors the limit for matched results', () => {
    expect(fuzzySearch('a', ['a', 'ba', 'ca', 'da'], { limit: 2 })).toHaveLength(2);
  });
});
