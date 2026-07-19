import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DiffReviewState {
  // scopeKey → path\0contentHash keys. Hash mismatch = unreviewed after edits.
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
          // One live key per path — drop stale post-edit hashes before re-adding.
          const prefix = reviewKey.slice(0, reviewKey.lastIndexOf('\0') + 1);
          const pruned = current.filter((k) => !k.startsWith(prefix));
          const next = wasReviewed ? pruned : [...pruned, reviewKey];
          const reviewedByScope = { ...state.reviewedByScope };
          if (next.length === 0) delete reviewedByScope[scopeKey];
          else reviewedByScope[scopeKey] = next;
          return { reviewedByScope };
        }),
    }),
    { name: 'diff-review-storage' },
  ),
);
