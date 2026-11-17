import { describe, expect, it } from 'vitest';
import { findTextMatches } from './findTextMatches';

describe('findTextMatches', () => {
  it('finds matches across adjacent nodes, in order, with node-local offsets', () => {
    const texts = ['await ', 'load', '(', 'id', ');', '', ' load', '(id)'];

    expect(findTextMatches(texts, 'load(id')).toEqual([
      { startNode: 1, startOffset: 0, endNode: 3, endOffset: 2 },
      { startNode: 6, startOffset: 1, endNode: 7, endOffset: 3 },
    ]);
  });

  it('keeps matches inside one node and does not overlap them', () => {
    expect(findTextMatches(['aaaa', 'a'], 'aa')).toEqual([
      { startNode: 0, startOffset: 0, endNode: 0, endOffset: 2 },
      { startNode: 0, startOffset: 2, endNode: 0, endOffset: 4 },
    ]);
    expect(findTextMatches(['load', '(id'], 'zzz')).toEqual([]);
  });
});
