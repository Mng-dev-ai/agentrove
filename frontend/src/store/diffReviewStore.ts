import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DiffReviewState {
  // scopeKey (`sandbox\0cwd\0mode`) -> reviewed file keys (`path\0contentHash`).
  // The content hash means a ✓ stops matching once the file changes, so the UI
  // treats it as unreviewed; the stale key itself is pruned the next time that
  // file is toggled (see below), keeping a bucket to at most one key per path.
  reviewedByScope: Record<string, string[]>;
  toggleReviewed: (scopeKey: string, reviewKey: string) => void;
}

export const useDiffReviewStore = create<DiffReviewState>()(
  persist(
    (set) => ({
      reviewedByScope: {},
      toggleReviewed: (scopeKey, reviewKey) =>
        set((state) => {
          const current = state.reviewedByScope[scopeKey] ?? [];
          const wasReviewed = current.includes(reviewKey);
          // A file has exactly one live key, so drop every key for this path
          // (the current one plus any stale post-edit hashes) before re-adding.
          const prefix = reviewKey.slice(0, reviewKey.lastIndexOf('\0') + 1);
          const pruned = current.filter((k) => !k.startsWith(prefix));
          const next = wasReviewed ? pruned : [...pruned, reviewKey];
          const reviewedByScope = { ...state.reviewedByScope };
          // Drop emptied buckets so storage doesn't accumulate dead scopes.
          if (next.length === 0) delete reviewedByScope[scopeKey];
          else reviewedByScope[scopeKey] = next;
          return { reviewedByScope };
        }),
    }),
    { name: 'diff-review-storage' },
  ),
);
