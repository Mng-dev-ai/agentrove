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
