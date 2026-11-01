// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useDiffReviewStore } from './diffReviewStore';

const key = (path: string, hash: string) => `${path}\0${hash}`;
const scoped = () => useDiffReviewStore.getState().reviewedByScope;
const toggle = (scope: string, reviewKey: string) =>
  useDiffReviewStore.getState().toggleReviewed(scope, reviewKey);

beforeEach(() => {
  localStorage.clear();
  useDiffReviewStore.setState({ reviewedByScope: {} });
});

describe('toggleReviewed', () => {
  it('un-reviews on a second toggle and drops the emptied scope bucket', () => {
    toggle('scope', key('a.ts', 'h1'));
    expect(scoped().scope).toEqual([key('a.ts', 'h1')]);
    toggle('scope', key('a.ts', 'h1'));
    expect('scope' in scoped()).toBe(false);
  });

  it('replaces a stale hash key for the same path with the new one', () => {
    toggle('scope', key('a.ts', 'old'));
    toggle('scope', key('a.ts', 'new'));
    expect(scoped().scope).toEqual([key('a.ts', 'new')]);
  });

  it('does not treat a path that is a prefix of another path as the same file', () => {
    toggle('scope', key('a.ts', 'h1'));
    toggle('scope', key('a.tsx', 'h2'));
    expect(scoped().scope).toEqual([key('a.ts', 'h1'), key('a.tsx', 'h2')]);
  });

  it('un-reviews one path without disturbing the others', () => {
    toggle('scope', key('a.ts', 'h1'));
    toggle('scope', key('b.ts', 'h2'));
    toggle('scope', key('a.ts', 'h1'));
    expect(scoped().scope).toEqual([key('b.ts', 'h2')]);
  });

  it('keeps scopes isolated from each other', () => {
    toggle('s1', key('a.ts', 'h1'));
    toggle('s2', key('a.ts', 'h1'));
    toggle('s1', key('a.ts', 'h1'));
    expect(scoped()).toEqual({ s2: [key('a.ts', 'h1')] });
  });
});
