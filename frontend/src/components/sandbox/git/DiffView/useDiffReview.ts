import {
  useCallback,
  useMemo,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { FileDiffMetadata } from '@pierre/diffs';
import { useDiffReviewStore } from '@/store/diffReviewStore';
import { hashDiffContent } from './diffView.utils';

interface UseDiffReviewParams {
  parsedFiles: FileDiffMetadata[];
  scopeKey: string;
  collapsedFiles: Set<string>;
  setCollapsedFiles: Dispatch<SetStateAction<Set<string>>>;
  toggleCollapsed: (name: string) => void;
  // Files we collapsed because they were marked reviewed. Owned by the parent
  // (its scope-reset clears it) and shared with the scroll hook, so it's passed
  // in rather than created here.
  reviewCollapsedRef: RefObject<Set<string>>;
}

// GitHub-style "Viewed" tracking: which files are marked reviewed, plus the
// collapse ownership that mirrors it (auto-collapse on review, reopen on
// un-review / content-invalidation) without fighting the user's manual choices.
export function useDiffReview({
  parsedFiles,
  scopeKey,
  collapsedFiles,
  setCollapsedFiles,
  toggleCollapsed,
  reviewCollapsedRef,
}: UseDiffReviewParams) {
  // Latest collapsedFiles for reads inside the stable toggleReviewed callback,
  // so it can spot a pre-existing manual collapse without depending on the set.
  const collapsedFilesRef = useRef(collapsedFiles);
  collapsedFilesRef.current = collapsedFiles;

  // path -> `path\0contentHash`. The hash folds a file's changed lines in, so a
  // key stored as "reviewed" stops matching once the file's content shifts.
  const reviewKeyByFile = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of parsedFiles) {
      const content = `${file.deletionLines.join('')}\0${file.additionLines.join('')}`;
      map.set(file.name, `${file.name}\0${hashDiffContent(content)}`);
    }
    return map;
  }, [parsedFiles]);

  // Persisted reviewed keys for this scope (survives reloads). Undefined until
  // the user marks anything, so default to empty.
  const reviewedKeys = useDiffReviewStore((s) => s.reviewedByScope[scopeKey]);

  // Names whose current key is marked reviewed — only ever holds live files, so
  // stale keys left behind by edits don't inflate the count.
  const reviewedNames = useMemo(() => {
    const stored = new Set(reviewedKeys ?? []);
    const names = new Set<string>();
    reviewKeyByFile.forEach((key, name) => {
      if (stored.has(key)) names.add(name);
    });
    return names;
  }, [reviewKeyByFile, reviewedKeys]);

  // Re-expand any review-collapsed file whose ✓ just invalidated (its content
  // changed, so reviewedNames dropped it). Render-phase reconcile — cheaper than
  // an effect, and self-terminating since each name is removed once reopened.
  if (reviewCollapsedRef.current.size > 0) {
    const reopen: string[] = [];
    reviewCollapsedRef.current.forEach((name) => {
      if (!reviewedNames.has(name)) reopen.push(name);
    });
    if (reopen.length > 0) {
      for (const name of reopen) reviewCollapsedRef.current.delete(name);
      setCollapsedFiles((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const name of reopen) if (next.delete(name)) changed = true;
        return changed ? next : prev;
      });
    }
  }

  const allCollapsed =
    parsedFiles.length > 0 && parsedFiles.every((f) => collapsedFiles.has(f.name));

  const toggleAll = useCallback(() => {
    // A bulk collapse/expand is a user override — drop all review-collapse
    // ownership so a later un-review/invalidation won't fight the user's choice.
    reviewCollapsedRef.current = new Set();
    setCollapsedFiles((prev) => {
      const allOff = parsedFiles.length > 0 && parsedFiles.every((f) => prev.has(f.name));
      if (allOff) return new Set();
      return new Set(parsedFiles.map((f) => f.name));
    });
  }, [parsedFiles, setCollapsedFiles]);

  // Chevron/header toggle — manually changing a file's collapse hands ownership
  // back to the user, so drop our review-collapse claim on it first.
  const handleToggleCollapsed = useCallback(
    (name: string) => {
      reviewCollapsedRef.current.delete(name);
      toggleCollapsed(name);
    },
    [toggleCollapsed],
  );

  const toggleReviewed = useCallback(
    (name: string) => {
      const key = reviewKeyByFile.get(name);
      if (!key) return;
      const store = useDiffReviewStore.getState();
      const willReview = !(store.reviewedByScope[scopeKey]?.includes(key) ?? false);
      store.toggleReviewed(scopeKey, key);
      // Collapse on review / reopen on un-review, mirroring GitHub's "Viewed".
      if (willReview) {
        // Only auto-collapse (and claim it as ours) when the file isn't already
        // collapsed — a manual collapse must outlive a later un-review/invalidate.
        if (!collapsedFilesRef.current.has(name)) {
          reviewCollapsedRef.current.add(name);
          setCollapsedFiles((prev) => {
            if (prev.has(name)) return prev;
            const next = new Set(prev);
            next.add(name);
            return next;
          });
        }
      } else if (reviewCollapsedRef.current.delete(name)) {
        // Un-review reopens only the collapse we added, never a manual one.
        setCollapsedFiles((prev) => {
          if (!prev.has(name)) return prev;
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      }
    },
    [reviewKeyByFile, scopeKey, setCollapsedFiles],
  );

  return {
    reviewKeyByFile,
    reviewedNames,
    allCollapsed,
    toggleAll,
    handleToggleCollapsed,
    toggleReviewed,
  };
}
