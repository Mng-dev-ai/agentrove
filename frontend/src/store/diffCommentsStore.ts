import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SelectedLineRange } from '@pierre/diffs';

export interface DiffComment extends SelectedLineRange {
  id: string;
  // Diff-relative file name; the workspace path is resolved at send time.
  path: string;
  snippet: string;
  body: string;
}

interface DiffCommentsState {
  // scopeKey → pending review comments not yet sent to the agent.
  commentsByScope: Record<string, DiffComment[]>;
  addComment: (scopeKey: string, comment: Omit<DiffComment, 'id'>) => void;
  updateComment: (scopeKey: string, id: string, body: string) => void;
  removeComment: (scopeKey: string, id: string) => void;
  clearScope: (scopeKey: string) => void;
}

function withScope(
  commentsByScope: Record<string, DiffComment[]>,
  scopeKey: string,
  comments: DiffComment[],
): { commentsByScope: Record<string, DiffComment[]> } {
  const next = { ...commentsByScope };
  if (comments.length === 0) delete next[scopeKey];
  else next[scopeKey] = comments;
  return { commentsByScope: next };
}

export const useDiffCommentsStore = create<DiffCommentsState>()(
  persist(
    (set) => ({
      commentsByScope: {},
      addComment: (scopeKey, comment) =>
        set((state) =>
          withScope(state.commentsByScope, scopeKey, [
            ...(state.commentsByScope[scopeKey] ?? []),
            { ...comment, id: crypto.randomUUID() },
          ]),
        ),
      updateComment: (scopeKey, id, body) =>
        set((state) =>
          withScope(
            state.commentsByScope,
            scopeKey,
            (state.commentsByScope[scopeKey] ?? []).map((c) => (c.id === id ? { ...c, body } : c)),
          ),
        ),
      removeComment: (scopeKey, id) =>
        set((state) =>
          withScope(
            state.commentsByScope,
            scopeKey,
            (state.commentsByScope[scopeKey] ?? []).filter((c) => c.id !== id),
          ),
        ),
      clearScope: (scopeKey) => set((state) => withScope(state.commentsByScope, scopeKey, [])),
    }),
    { name: 'diff-comments-storage' },
  ),
);
