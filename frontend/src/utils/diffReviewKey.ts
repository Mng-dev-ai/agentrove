import type { FileDiffMetadata } from '@pierre/diffs';

export function hashDiffContent(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

// `path\0contentHash`. The hash folds a file's changed lines in, so a stored key
// (review ✓, comment anchor) stops matching once the file's content shifts.
export function reviewKeyFor(file: FileDiffMetadata): string {
  const content = `${file.deletionLines.join('')}\0${file.additionLines.join('')}`;
  return `${file.name}\0${hashDiffContent(content)}`;
}

export function buildReviewKeys(files: FileDiffMetadata[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of files) map.set(file.name, reviewKeyFor(file));
  return map;
}

// Whitespace mode yields different hunks, so caches and remount keys must tell
// the two apart.
export const whitespaceKeySuffix = (ignoreWhitespace: boolean) => (ignoreWhitespace ? ':ws' : '');
