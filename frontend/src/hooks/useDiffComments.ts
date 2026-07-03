import { useCallback, useState } from 'react';
import type { FileDiffMetadata, SelectedLineRange } from '@pierre/diffs';
import { useUIStore } from '@/store/uiStore';
import { getSelectedDiffText } from '@/utils/diffSelection';

interface PendingDiffComment {
  fileName: string;
  range: SelectedLineRange;
  composing: boolean;
}

// The library reports selections in anchor→pointer order, so an upward drag
// yields start > end. Old/new line numbers aren't comparable across sides
// (split view), so only same-side selections can be safely reordered —
// cross-side ranges keep the library's order.
function normalizeSelection(range: SelectedLineRange): SelectedLineRange {
  const sameSide = (range.endSide ?? range.side) === range.side;
  if (!sameSide || range.start <= range.end) return range;
  return { start: range.end, end: range.start, side: range.side, endSide: range.endSide };
}

// Diff-view review comments: one line selection at a time across all files;
// `composing` flips on when the drag ends, which opens the composer. Submits
// attach the selection + comment to the chat input as an editor-selection chip.
export function useDiffComments(chatId: string | undefined, cwd: string | undefined) {
  const [pendingComment, setPendingComment] = useState<PendingDiffComment | null>(null);

  // Raw (anchor-order) range during the drag — it matches the library's own
  // representation, so the equality guards inside the manager stay effective.
  const handleSelectionChange = useCallback((fileName: string, range: SelectedLineRange | null) => {
    setPendingComment(range ? { fileName, range, composing: false } : null);
  }, []);

  const handleSelectionEnd = useCallback((fileName: string, range: SelectedLineRange | null) => {
    setPendingComment(
      range ? { fileName, range: normalizeSelection(range), composing: true } : null,
    );
  }, []);

  const resetComments = useCallback(() => setPendingComment(null), []);

  const handleSubmitComment = useCallback(
    (file: FileDiffMetadata, range: SelectedLineRange, comment: string) => {
      if (!chatId) return;
      // Attach even when snippet extraction comes up empty — losing the typed
      // comment is worse than an empty code block.
      const snippet = getSelectedDiffText(file, range);
      useUIStore.getState().addEditorSelection(chatId, {
        // Same workspace-root basis as "open in editor" and editor selections.
        path: cwd ? `${cwd}/${file.name}` : file.name,
        startLine: range.start,
        endLine: range.end,
        languageId: 'diff',
        text: snippet ?? '',
        comment,
      });
      setPendingComment(null);
    },
    [chatId, cwd],
  );

  return {
    pendingComment,
    resetComments,
    handleSelectionChange,
    handleSelectionEnd,
    handleSubmitComment,
  };
}
