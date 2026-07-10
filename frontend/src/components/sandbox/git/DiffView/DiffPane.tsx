import type { RefObject } from 'react';
import { AlertCircle, GitCompareArrows } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import type { FileDiffMetadata, SelectedLineRange } from '@pierre/diffs';
import { Virtualizer } from '@pierre/diffs/react';
import { DiffFileRow } from '@/components/sandbox/git/DiffFileRow/DiffFileRow';
import type { FileChangeStats } from '@/components/sandbox/git/DiffFileSidebar/DiffFileSidebar';
import type { DiffMode } from '@/types/sandbox.types';
import { DiffEmptyState } from './DiffEmptyState';
import { DIFF_EMPTY_LABELS, VIRTUALIZER_CONFIG } from './diffView.utils';
import styles from './DiffView.module.scss';

interface DiffPaneProps {
  paneRef: RefObject<HTMLDivElement | null>;
  isLoading: boolean;
  isError: boolean;
  isGitRepo: boolean;
  ready: boolean;
  diffError: string | null;
  hasChanges: boolean;
  mode: DiffMode;
  showFiles: boolean;
  parsedFiles: FileDiffMetadata[];
  onRefetch: () => void;
  openDiscardAll: () => void;
  canDiscard: boolean;
  discardPending: boolean;
  reviewKeyByFile: Map<string, string>;
  collapsedFiles: Set<string>;
  reviewedNames: Set<string>;
  statsByFile: Map<string, FileChangeStats>;
  cwd: string | undefined;
  chatId: string | undefined;
  options: Record<string, unknown>;
  pendingComment: { fileName: string; range: SelectedLineRange; composing: boolean } | null;
  onToggle: (name: string) => void;
  onToggleReviewed: (name: string) => void;
  onDiscard: (file: FileDiffMetadata) => void;
  onSelectionChange: (fileName: string, range: SelectedLineRange | null) => void;
  onSelectionEnd: (fileName: string, range: SelectedLineRange | null) => void;
  onSubmitComment: (file: FileDiffMetadata, range: SelectedLineRange, comment: string) => void;
  onCancelComment: () => void;
}

export function DiffPane({
  paneRef,
  isLoading,
  isError,
  isGitRepo,
  ready,
  diffError,
  hasChanges,
  mode,
  showFiles,
  parsedFiles,
  onRefetch,
  openDiscardAll,
  canDiscard,
  discardPending,
  reviewKeyByFile,
  collapsedFiles,
  reviewedNames,
  statsByFile,
  cwd,
  chatId,
  options,
  pendingComment,
  onToggle,
  onToggleReviewed,
  onDiscard,
  onSelectionChange,
  onSelectionEnd,
  onSubmitComment,
  onCancelComment,
}: DiffPaneProps) {
  return (
    <div ref={paneRef} className={styles.pane}>
      {isLoading && (
        <div className={styles['pane-loading']}>
          <Spinner size="md" className={styles.spinner} />
        </div>
      )}

      {!isLoading && isError && (
        <DiffEmptyState icon={AlertCircle} label="Failed to load diff">
          <Button onClick={onRefetch} variant="unstyled" className={styles['empty-link']}>
            Retry
          </Button>
        </DiffEmptyState>
      )}

      {!isLoading && !isError && !isGitRepo && (
        <DiffEmptyState icon={GitCompareArrows} label="Not a git repository" />
      )}

      {ready && diffError && <DiffEmptyState icon={GitCompareArrows} label={diffError} />}

      {ready && !diffError && !hasChanges && (
        <DiffEmptyState icon={GitCompareArrows} label={DIFF_EMPTY_LABELS[mode]} />
      )}

      {showFiles && (
        // Virtualizer as scroll root — FileDiff auto-switches to the
        // virtualized impl so offscreen hunks stay unrendered.
        // overflow-anchor off: the library restores its own line-level
        // scroll anchor on height changes (composer row insert/remove),
        // and native anchoring double-corrects into a visible jump.
        // CodeView disables it on its root; plain Virtualizer doesn't.
        <Virtualizer
          config={VIRTUALIZER_CONFIG}
          className={styles.virtualizer}
          contentClassName={styles['virtualizer-content']}
        >
          {parsedFiles.map((file) => (
            <DiffFileRow
              key={file.name}
              file={file}
              contentKey={reviewKeyByFile.get(file.name)}
              isExpanded={!collapsedFiles.has(file.name)}
              isReviewed={reviewedNames.has(file.name)}
              stats={statsByFile.get(file.name)}
              canDiscard={canDiscard}
              discardPending={discardPending}
              cwd={cwd}
              chatId={chatId}
              options={options}
              commentRange={pendingComment?.fileName === file.name ? pendingComment.range : null}
              isComposing={pendingComment?.fileName === file.name && pendingComment.composing}
              onToggle={onToggle}
              onToggleReviewed={onToggleReviewed}
              onDiscard={onDiscard}
              onSelectionChange={onSelectionChange}
              onSelectionEnd={onSelectionEnd}
              onSubmitComment={onSubmitComment}
              onCancelComment={onCancelComment}
            />
          ))}
        </Virtualizer>
      )}

      {ready && hasChanges && parsedFiles.length === 0 && (
        <DiffEmptyState
          icon={GitCompareArrows}
          label="Changes detected but diff cannot be displayed"
          sublabel="Binary or unsupported file formats"
        >
          {canDiscard && (
            <Button onClick={openDiscardAll} variant="unstyled" className={styles['empty-link']}>
              Discard all changes
            </Button>
          )}
        </DiffEmptyState>
      )}
    </div>
  );
}
