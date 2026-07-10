// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useDiffReviewStore } from './diffReviewStore';

// Review keys are `path\0contentHash`; a scope groups keys under one target.
const key = (path: string, hash: string) => `${path}\0${hash}`;
const scoped = () => useDiffReviewStore.getState().reviewedByScope;

beforeEach(() => {
  localStorage.clear();
  useDiffReviewStore.setState({ reviewedByScope: {} });
});

describe('toggleReviewed', () => {
  it('marks a file reviewed under its scope', () => {
    useDiffReviewStore.getState().toggleReviewed('scope', key('a.ts', 'h1'));
    expect(scoped().scope).toEqual([key('a.ts', 'h1')]);
  });

  it('un-reviews on a second toggle and drops the emptied scope bucket', () => {
    const k = key('a.ts', 'h1');
    useDiffReviewStore.getState().toggleReviewed('scope', k);
    useDiffReviewStore.getState().toggleReviewed('scope', k);
    expect('scope' in scoped()).toBe(false);
  });

  it('replaces a stale hash key for the same path with the new one', () => {
    // Reviewing the file, then editing it (new hash) and reviewing again must
    // leave exactly one live key for that path — no stale post-edit hash lingers.
    useDiffReviewStore.getState().toggleReviewed('scope', key('a.ts', 'old'));
    useDiffReviewStore.getState().toggleReviewed('scope', key('a.ts', 'new'));
    expect(scoped().scope).toEqual([key('a.ts', 'new')]);
  });

  it('keeps distinct paths in the same scope', () => {
    useDiffReviewStore.getState().toggleReviewed('scope', key('a.ts', 'h1'));
    useDiffReviewStore.getState().toggleReviewed('scope', key('b.ts', 'h2'));
    expect(scoped().scope).toEqual([key('a.ts', 'h1'), key('b.ts', 'h2')]);
  });

  it('un-reviews one path without disturbing the others', () => {
    const a = key('a.ts', 'h1');
    const b = key('b.ts', 'h2');
    useDiffReviewStore.getState().toggleReviewed('scope', a);
    useDiffReviewStore.getState().toggleReviewed('scope', b);
    useDiffReviewStore.getState().toggleReviewed('scope', a);
    expect(scoped().scope).toEqual([b]);
  });

  it('keeps scopes isolated from each other', () => {
    useDiffReviewStore.getState().toggleReviewed('s1', key('a.ts', 'h1'));
    useDiffReviewStore.getState().toggleReviewed('s2', key('a.ts', 'h1'));
    expect(scoped()).toEqual({
      s1: [key('a.ts', 'h1')],
      s2: [key('a.ts', 'h1')],
    });
  });
});
