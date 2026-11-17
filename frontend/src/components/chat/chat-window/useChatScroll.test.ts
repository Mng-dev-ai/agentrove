import { describe, it, expect } from 'vitest';
import { headAnchorId } from './useChatScroll';

describe('headAnchorId', () => {
  it('holds nothing while the head is unchanged, however the tail grows', () => {
    expect(headAnchorId(['u1', 'a1'], ['u1', 'a1'], 0)).toBeNull();
    expect(headAnchorId(['u1', 'a1'], ['u1', 'a1', 'u2', 'a2'], 1)).toBeNull();
  });

  it('holds the first visible message when an older page lands, even after stream flushes re-rendered the list', () => {
    const rendered = ['u1', 'a1', 'u2', 'a2'];
    expect(headAnchorId(rendered, rendered, 0)).toBeNull();
    expect(headAnchorId(rendered, ['u0', 'a0', ...rendered], 0)).toBe('u1');
    expect(headAnchorId(rendered, ['u0', 'a0', ...rendered], 2)).toBe('u2');
  });

  it('holds the next surviving message when a refetch drops the one at the top of the viewport', () => {
    expect(headAnchorId(['u1', 'a1', 'u2', 'a2'], ['u2', 'a2', 'u3'], 1)).toBe('u2');
  });

  it('holds nothing when no rendered message survives or none is in view', () => {
    expect(headAnchorId(['u1', 'a1'], ['x1', 'x2'], 0)).toBeNull();
    expect(headAnchorId(['u1', 'a1'], ['u0', 'u1', 'a1'], -1)).toBeNull();
    expect(headAnchorId([], ['u1'], -1)).toBeNull();
  });
});
