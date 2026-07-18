import type { FileDiffMetadata, FileContents } from '@pierre/diffs';
import type { DiffMode } from '@/types/sandbox.types';

export const DIFF_THEMES = { dark: 'pierre-dark', light: 'pierre-light' } as const;

// Wider pre-render halo than the library's 1000px default — fast scrolling
// through large files otherwise outruns rendering/highlighting (renders happen
// on scroll + rAF) and flashes unstyled text or striped buffer regions.
export const VIRTUALIZER_CONFIG = { overscrollSize: 2500, intersectionObserverMargin: 10000 };

// Label-only rename: `all` stays the wire value — query keys, the scopeKey,
// and persisted review-✓ state are keyed by it.
export const DIFF_MODE_OPTIONS = [
  { value: 'all', label: 'Uncommitted' },
  { value: 'branch', label: 'Branch' },
] satisfies { value: DiffMode; label: string }[];

export const DIFF_STYLE_OPTIONS = [
  { value: 'unified', label: 'Unified' },
  { value: 'split', label: 'Split' },
] satisfies { value: 'unified' | 'split'; label: string }[];

export const SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
]);

export const DIFF_EMPTY_LABELS: Record<DiffMode, string> = {
  all: 'No uncommitted changes',
  branch: 'No changes from base branch',
};

// The library washes annotation rows with the line-selection tint when they sit
// inside the selected range; keep the comment composer's row on the plain
// annotation background. Injected into the shadow root, where unlayered rules
// beat the library's @layer base styles.
export const DIFF_UNSAFE_CSS =
  '[data-selected-line]:is([data-line-annotation],[data-gutter-buffer=annotation]){--diffs-computed-selected-line-bg:var(--diffs-annotation-bg)}';

// Below this tile width the sidebar can't coexist with a readable diff — it
// collapses into the toolbar file dropdown instead.
export const NARROW_BREAKPOINT = 600;

export const FILES_PANEL_WIDTH = 256;
export const OVERFLOW_PANEL_WIDTH = 220;

// 6px below trigger, left-aligned, clamped so the panel stays on screen.
export const computeMenuPos = (rect: DOMRect) => ({
  top: rect.bottom + 6,
  left: Math.max(8, Math.min(rect.left, window.innerWidth - FILES_PANEL_WIDTH - 8)),
});

// 6px below trigger, right-aligned to the trigger (overflow lives at the
// toolbar's right edge), clamped so the panel stays on screen.
export const computeOverflowMenuPos = (rect: DOMRect) => ({
  top: rect.bottom + 6,
  left: Math.max(
    8,
    Math.min(rect.right - OVERFLOW_PANEL_WIDTH, window.innerWidth - OVERFLOW_PANEL_WIDTH - 8),
  ),
});

// Dir-major path order: a directory's files sort together, before any of its
// subdirectories' files. The raw patch isn't display-ordered (untracked diffs
// are appended after the tracked diff), and even git's own path sort splits a
// directory (`a/sub/x.ts` lands between `a/b.ts` and `a/z.ts`). The sidebar's
// consecutive dir grouping and its sidebar-order == scroll-order assumption
// both rely on this ordering.
export function compareFilePaths(a: string, b: string): number {
  const dirA = a.slice(0, a.lastIndexOf('/') + 1);
  const dirB = b.slice(0, b.lastIndexOf('/') + 1);
  if (dirA !== dirB) return dirA < dirB ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// Nearest scrollable ancestor, bounded to the diff pane — the Virtualizer owns
// the scroll container and doesn't expose a ref to it. The overflow style is
// checked, not just the heights: scrollHeight/clientHeight round to integers,
// so with fractional layout heights (retina/zoom) a plain flow div can read
// scrollHeight == clientHeight + 1. Height comparison alone then picks the
// Virtualizer's content wrapper, where scrollTop writes are silently clamped
// to 0 and jump-to-file dies without a trace.
export function findScroller(el: HTMLElement, boundary: HTMLElement | null): HTMLElement | null {
  for (let p = el.parentElement; p && p !== boundary; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    const scrollable = overflowY === 'auto' || overflowY === 'scroll';
    if (scrollable && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

// Backend always sends full-context diffs, so deletion/additionLines hold the
// complete bodies. Lines keep trailing '\n', so raw join reconstructs the file.
function extractContents(
  file: FileDiffMetadata,
): { oldContent: string; newContent: string } | null {
  if (file.deletionLines.length === 0 && file.additionLines.length === 0) return null;
  return {
    oldContent: file.deletionLines.join(''),
    newContent: file.additionLines.join(''),
  };
}

export function hashDiffContent(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

// The runtime FileDiffMetadata carries an `oldMode` the published types omit
// (they only declare `mode`/`prevMode`); widen locally to copy it through.
type FileDiffWithOldMode = FileDiffMetadata & { oldMode?: string };

// Re-diff with limited context so the library emits collapsedBefore gaps for
// the expand-on-click UI.
export function rebuildWithCollapsedContext(
  fullFile: FileDiffMetadata,
  parseDiffFromFile: (old: FileContents, cur: FileContents) => FileDiffMetadata,
): FileDiffMetadata {
  const contents = extractContents(fullFile);
  if (!contents) return fullFile;
  const rebuilt = parseDiffFromFile(
    {
      name: fullFile.prevName ?? fullFile.name,
      contents: contents.oldContent,
      cacheKey: fullFile.cacheKey ? `${fullFile.cacheKey}:old` : undefined,
    },
    {
      name: fullFile.name,
      contents: contents.newContent,
      cacheKey: fullFile.cacheKey ? `${fullFile.cacheKey}:new` : undefined,
    },
  );
  rebuilt.type = fullFile.type;
  rebuilt.prevName = fullFile.prevName;
  if (fullFile.mode) rebuilt.mode = fullFile.mode;
  const source = fullFile as FileDiffWithOldMode;
  if (source.oldMode) (rebuilt as FileDiffWithOldMode).oldMode = source.oldMode;
  return rebuilt;
}
