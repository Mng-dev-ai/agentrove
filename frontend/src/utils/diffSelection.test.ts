import { describe, it, expect } from 'vitest';
import type { ChangeContent, ContextContent, FileDiffMetadata, Hunk } from '@pierre/diffs';
import { getSelectedDiffText } from './diffSelection';

// Minimal hunk-content builders — getSelectedDiffText only reads the fields below.
const ctx = (lines: number, delIdx: number, addIdx: number): ContextContent => ({
  type: 'context',
  lines,
  deletionLineIndex: delIdx,
  additionLineIndex: addIdx,
});

const chg = (
  deletions: number,
  delIdx: number,
  additions: number,
  addIdx: number,
): ChangeContent => ({
  type: 'change',
  deletions,
  deletionLineIndex: delIdx,
  additions,
  additionLineIndex: addIdx,
});

const hunk = (
  over: Pick<
    Hunk,
    'deletionStart' | 'additionStart' | 'deletionLineIndex' | 'additionLineIndex' | 'hunkContent'
  >,
): Hunk => over as Hunk;

const file = (over: {
  additionLines: string[];
  deletionLines: string[];
  hunks: Hunk[];
}): FileDiffMetadata =>
  ({ name: 'f.ts', type: 'change', isPartial: false, ...over }) as unknown as FileDiffMetadata;

// Full-file diff (line N ↔ index N-1) with one change in the middle.
const singleHunkFullBody = file({
  additionLines: ['a\n', 'b-new\n', 'c\n'],
  deletionLines: ['a\n', 'b-old\n', 'c\n'],
  hunks: [
    hunk({
      deletionStart: 1,
      additionStart: 1,
      deletionLineIndex: 0,
      additionLineIndex: 0,
      hunkContent: [ctx(1, 0, 0), chg(1, 1, 1, 1), ctx(1, 2, 2)],
    }),
  ],
});

// Full-file diff with two hunks separated by an unchanged gap (lines 3–5). Full
// bodies let the gap be expanded and addressed by line number.
const twoHunkFullBody = file({
  additionLines: ['l1\n', 'l2\n', 'l3\n', 'l4\n', 'l5\n', 'l6\n', 'l7\n'],
  deletionLines: ['l1\n', 'l2old\n', 'l3\n', 'l4\n', 'l5\n', 'l6old\n', 'l7\n'],
  hunks: [
    hunk({
      deletionStart: 1,
      additionStart: 1,
      deletionLineIndex: 0,
      additionLineIndex: 0,
      hunkContent: [ctx(1, 0, 0), chg(1, 1, 1, 1)],
    }),
    hunk({
      deletionStart: 6,
      additionStart: 6,
      deletionLineIndex: 5,
      additionLineIndex: 5,
      hunkContent: [chg(1, 5, 1, 5), ctx(1, 6, 6)],
    }),
  ],
});

// Partial patch: line arrays hold only patch lines, hunk indices don't align to
// line numbers, so the gap between hunks (lines 12–49) can't be expanded.
const twoHunkPartial = file({
  additionLines: ['c1\n', 'new1\n', 'new2\n', 'c2\n'],
  deletionLines: ['c1\n', 'old1\n', 'old2\n', 'c2\n'],
  hunks: [
    hunk({
      deletionStart: 10,
      additionStart: 10,
      deletionLineIndex: 0,
      additionLineIndex: 0,
      hunkContent: [ctx(1, 0, 0), chg(1, 1, 1, 1)],
    }),
    hunk({
      deletionStart: 50,
      additionStart: 50,
      deletionLineIndex: 2,
      additionLineIndex: 2,
      hunkContent: [chg(1, 2, 1, 2), ctx(1, 3, 3)],
    }),
  ],
});

// Partial patch removing two lines — a change block with additions: 0.
const pureDeletionPartial = file({
  additionLines: ['keep\n'],
  deletionLines: ['keep\n', 'gone1\n', 'gone2\n'],
  hunks: [
    hunk({
      deletionStart: 5,
      additionStart: 5,
      deletionLineIndex: 0,
      additionLineIndex: 0,
      hunkContent: [ctx(1, 0, 0), chg(2, 1, 0, 1)],
    }),
  ],
});

describe('getSelectedDiffText — single-hunk full body', () => {
  it('emits the whole hunk with unified prefixes when no side is given', () => {
    const text = getSelectedDiffText(singleHunkFullBody, { start: 1, end: 3 });
    expect(text).toBe(' a\n-b-old\n+b-new\n c');
  });

  it('selects a single line on the deletion side', () => {
    const text = getSelectedDiffText(singleHunkFullBody, { start: 2, end: 2, side: 'deletions' });
    expect(text).toBe('-b-old');
  });

  it('selects a single line on the addition side', () => {
    const text = getSelectedDiffText(singleHunkFullBody, { start: 2, end: 2, side: 'additions' });
    expect(text).toBe('+b-new');
  });

  it('honors endSide differing from side across the changed pair', () => {
    const text = getSelectedDiffText(singleHunkFullBody, {
      start: 2,
      side: 'deletions',
      end: 2,
      endSide: 'additions',
    });
    expect(text).toBe('-b-old\n+b-new');
  });

  it('returns null when the range does not resolve against the hunks', () => {
    expect(getSelectedDiffText(singleHunkFullBody, { start: 99, end: 100 })).toBeNull();
  });
});

describe('getSelectedDiffText — multi-hunk full body (gap expansion)', () => {
  it('fills the unchanged gap between hunks when selecting across it', () => {
    const text = getSelectedDiffText(twoHunkFullBody, {
      start: 2,
      side: 'additions',
      end: 6,
      endSide: 'additions',
    });
    expect(text).toBe('+l2\n l3\n l4\n l5\n-l6old\n+l6');
  });

  it('resolves a deletion-side range spanning the gap', () => {
    const text = getSelectedDiffText(twoHunkFullBody, {
      start: 2,
      side: 'deletions',
      end: 6,
      endSide: 'deletions',
    });
    expect(text).toBe('-l2old\n+l2\n l3\n l4\n l5\n-l6old');
  });
});

describe('getSelectedDiffText — partial patch (no gap expansion)', () => {
  it('joins the two hunks directly, silently omitting the unexpandable gap', () => {
    // Documented behavior: partial patches can't expand context between hunks,
    // so lines 12–49 are absent and the addition rows sit adjacent.
    const text = getSelectedDiffText(twoHunkPartial, {
      start: 11,
      side: 'additions',
      end: 50,
      endSide: 'additions',
    });
    expect(text).toBe('+new1\n-old2\n+new2');
  });

  it('returns null for a line number that lives inside the unrendered gap', () => {
    expect(
      getSelectedDiffText(twoHunkPartial, {
        start: 30,
        side: 'additions',
        end: 30,
        endSide: 'additions',
      }),
    ).toBeNull();
  });

  it('resolves a context line on either implicit side', () => {
    expect(getSelectedDiffText(twoHunkPartial, { start: 10, end: 10 })).toBe(' c1');
  });
});

describe('getSelectedDiffText — pure deletion block', () => {
  it('selects consecutive deleted lines', () => {
    const text = getSelectedDiffText(pureDeletionPartial, {
      start: 6,
      side: 'deletions',
      end: 7,
      endSide: 'deletions',
    });
    expect(text).toBe('-gone1\n-gone2');
  });

  it('returns null when asking for an addition line that never existed', () => {
    expect(
      getSelectedDiffText(pureDeletionPartial, {
        start: 6,
        side: 'additions',
        end: 6,
        endSide: 'additions',
      }),
    ).toBeNull();
  });
});

describe('getSelectedDiffText — empty input', () => {
  it('returns null for a file with no hunks', () => {
    const empty = file({ additionLines: [], deletionLines: [], hunks: [] });
    expect(getSelectedDiffText(empty, { start: 1, end: 1 })).toBeNull();
  });
});
