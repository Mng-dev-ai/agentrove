import { useCallback, useMemo, useState, type RefObject } from 'react';
import type { FileDiffMetadata, SelectedLineRange } from '@pierre/diffs';
import { useUIStore } from '@/store/uiStore';
import { useDiffCommentsStore, type DiffComment } from '@/store/diffCommentsStore';
import { getSelectedDiffText } from '@/utils/diffSelection';
import { reviewKeyFor } from '@/utils/diffReviewKey';
import { compareFilePaths } from '@/utils/filePaths';

interface PendingDiffComment {
  fileName: string;
  range: SelectedLineRange;
  composing: boolean;
}

const NO_COMMENTS: DiffComment[] = [];

const OUTDATED_NOTE =
  '(Outdated: the file changed after this comment, so these line numbers refer to an earlier version.)';

// The library reports selections in anchor→pointer order, so an upward drag
// yields start > end. Old/new line numbers aren't comparable across sides
// (split view), so only same-side selections can be safely reordered —
// cross-side ranges keep the library's order.
function normalizeSelection(range: SelectedLineRange): SelectedLineRange {
  const sameSide = (range.endSide ?? range.side) === range.side;
  if (!sameSide || range.start <= range.end) return range;
  return { start: range.end, end: range.start, side: range.side, endSide: range.endSide };
}

// Diff review comments: a line selection opens the composer (`composing` on drag
// end), submits land in the scope's persisted pending list, and sending moves
// them all onto the chat input as editor-selection chips.
export function useDiffComments(
  chatId: string | undefined,
  cwd: string | undefined,
  scopeKey: string,
  rootRef: RefObject<HTMLDivElement | null>,
) {
  const [pendingComment, setPendingComment] = useState<PendingDiffComment | null>(null);
  const storedComments = useDiffCommentsStore((s) => s.commentsByScope[scopeKey]);
  // Without a chat there's nowhere to send them (landing page shares the scope).
  const comments = (chatId && storedComments) || NO_COMMENTS;

  const commentsByFile = useMemo(() => {
    const sorted = [...comments].sort((a, b) => compareFilePaths(a.path, b.path) || a.end - b.end);
    const map = new Map<string, DiffComment[]>();
    for (const comment of sorted) {
      const list = map.get(comment.path);
      if (list) list.push(comment);
      else map.set(comment.path, [comment]);
    }
    return map;
  }, [comments]);

  // Keep raw anchor-order during drag so the library's equality guards stay effective.
  const handleSelectionChange = useCallback((fileName: string, range: SelectedLineRange | null) => {
    setPendingComment(range ? { fileName, range, composing: false } : null);
  }, []);

  const handleSelectionEnd = useCallback((fileName: string, range: SelectedLineRange | null) => {
    setPendingComment(
      range ? { fileName, range: normalizeSelection(range), composing: true } : null,
    );
  }, []);

  const openComposer = useCallback(() => {
    setPendingComment((prev) =>
      prev ? { ...prev, range: normalizeSelection(prev.range), composing: true } : prev,
    );
    // The composer may already be open (autoFocus only fires on mount).
    requestAnimationFrame(() =>
      rootRef.current?.querySelector<HTMLTextAreaElement>('[data-diff-composer] textarea')?.focus(),
    );
  }, [rootRef]);

  const cancelComposer = useCallback(() => setPendingComment(null), []);

  const resetComments = useCallback(() => {
    setPendingComment(null);
    useDiffCommentsStore.getState().setEditingCommentId(null);
  }, []);

  const handleSubmitComment = useCallback(
    (file: FileDiffMetadata, range: SelectedLineRange, body: string) => {
      if (!chatId) return;
      useDiffCommentsStore.getState().addComment(scopeKey, {
        path: file.name,
        contentKey: reviewKeyFor(file),
        start: range.start,
        end: range.end,
        side: range.side,
        endSide: range.endSide,
        // Keep the comment even when snippet extraction comes up empty — losing
        // the typed text is worse than an empty code block.
        snippet: getSelectedDiffText(file, range) ?? '',
        body,
      });
      setPendingComment(null);
    },
    [chatId, scopeKey],
  );

  const deleteComment = useCallback(
    (id: string) => useDiffCommentsStore.getState().removeComment(scopeKey, id),
    [scopeKey],
  );

  const sendComments = useCallback(
    (reviewKeyByFile: Map<string, string>) => {
      if (!chatId) return;
      const { addComposerSelection } = useUIStore.getState();
      for (const list of commentsByFile.values()) {
        for (const comment of list) {
          addComposerSelection(chatId, {
            // Same workspace-root basis as "open in editor" and editor selections.
            path: cwd ? `${cwd}/${comment.path}` : comment.path,
            startLine: comment.start,
            endLine: comment.end,
            languageId: 'diff',
            text: comment.snippet,
            comment:
              comment.contentKey === reviewKeyByFile.get(comment.path)
                ? comment.body
                : `${OUTDATED_NOTE}\n${comment.body}`,
          });
        }
      }
      useDiffCommentsStore.getState().clearScope(scopeKey);
    },
    [chatId, cwd, scopeKey, commentsByFile],
  );

  return {
    pendingComment,
    comments,
    commentsByFile,
    resetComments,
    cancelComposer,
    openComposer,
    handleSelectionChange,
    handleSelectionEnd,
    handleSubmitComment,
    deleteComment,
    sendComments,
  };
}
