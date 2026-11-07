import { memo, useMemo, useCallback } from 'react';
import { ChevronRight, ExternalLink, Square, SquareCheck, Undo2 } from 'lucide-react';
import { FileIcon } from '@/components/ui/shared/FileIcon/FileIcon';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { Button } from '@/components/ui/primitives/Button/Button';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary/ErrorBoundary';
import { useUIStore } from '@/store/uiStore';
import type { FileDiffMetadata, SelectedLineRange, DiffLineAnnotation } from '@pierre/diffs';
import { DiffCommentComposer } from '@/components/sandbox/git/DiffCommentComposer/DiffCommentComposer';
import { DiffCommentCard } from '@/components/sandbox/git/DiffCommentComposer/DiffCommentCard';
import type { DiffComment } from '@/store/diffCommentsStore';
import { annotationSide, formatLineLabel } from '@/utils/diffSelection';
import type { FileChangeStats } from '@/components/sandbox/git/DiffFileSidebar/DiffFileSidebar';
import { FileDiff } from '@pierre/diffs/react';
import clsx from 'clsx';
import { isRenameFileType } from '@/utils/fileTypes';
import styles from './DiffFileRow.module.scss';

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  deleted: 'Deleted',
  'rename-pure': 'Renamed',
  'rename-changed': 'Renamed',
};

const STATUS_BADGE_MODIFIERS: Record<string, string> = {
  new: styles['status-badge--new'],
  deleted: styles['status-badge--deleted'],
  'rename-pure': styles['status-badge--renamed'],
  'rename-changed': styles['status-badge--renamed'],
};

type AnnotationMeta = { kind: 'composer' } | { kind: 'comment'; comment: DiffComment };

const FileDiffRenderer = memo(function FileDiffRenderer({
  file,
  options,
  canComment,
  commentRange,
  isComposing,
  comments,
  editingCommentId,
  onSelectionChange,
  onSelectionEnd,
  onSubmitComment,
  onCancelComment,
  onEditComment,
  onUpdateComment,
  onDeleteComment,
}: {
  file: FileDiffMetadata;
  options: Record<string, unknown>;
  canComment: boolean;
  commentRange: SelectedLineRange | null;
  isComposing: boolean;
  comments: DiffComment[];
  editingCommentId: string | null;
  onSelectionChange: (fileName: string, range: SelectedLineRange | null) => void;
  onSelectionEnd: (fileName: string, range: SelectedLineRange | null) => void;
  onSubmitComment: (file: FileDiffMetadata, range: SelectedLineRange, comment: string) => void;
  onCancelComment: () => void;
  onEditComment: (id: string | null) => void;
  onUpdateComment: (id: string, body: string) => void;
  onDeleteComment: (id: string) => void;
}) {
  // Selection is gated on a chat being connected — the comment has nowhere to
  // go otherwise. Fully controlled via `selectedLines` so closing the composer
  // clears the highlight; start/change echoes keep the drag highlight live
  // (the library doesn't self-render selection in controlled mode).
  const fileOptions = useMemo(
    () =>
      canComment
        ? {
            ...options,
            enableLineSelection: true,
            onLineSelectionStart: (range: SelectedLineRange | null) =>
              onSelectionChange(file.name, range),
            onLineSelectionChange: (range: SelectedLineRange | null) =>
              onSelectionChange(file.name, range),
            onLineSelectionEnd: (range: SelectedLineRange | null) =>
              onSelectionEnd(file.name, range),
          }
        : options,
    [options, canComment, file.name, onSelectionChange, onSelectionEnd],
  );

  // Memoized — the library re-renders a file whenever the annotations array
  // identity changes.
  const annotations = useMemo<DiffLineAnnotation<AnnotationMeta>[]>(() => {
    const out: DiffLineAnnotation<AnnotationMeta>[] = comments.map((comment) => ({
      side: annotationSide(comment),
      lineNumber: comment.end,
      metadata: { kind: 'comment', comment },
    }));
    if (isComposing && commentRange) {
      out.push({
        side: annotationSide(commentRange),
        lineNumber: commentRange.end,
        metadata: { kind: 'composer' },
      });
    }
    return out;
  }, [comments, isComposing, commentRange]);

  const renderAnnotation = useCallback(
    ({ metadata }: DiffLineAnnotation<AnnotationMeta>) => {
      if (metadata.kind === 'comment') {
        const { comment } = metadata;
        return (
          <div data-diff-comment={comment.id}>
            {comment.id === editingCommentId ? (
              <DiffCommentComposer
                lineLabel={formatLineLabel(comment)}
                initialValue={comment.body}
                onSubmit={(body) => onUpdateComment(comment.id, body)}
                onCancel={() => onEditComment(null)}
              />
            ) : (
              <DiffCommentCard
                lineLabel={formatLineLabel(comment)}
                body={comment.body}
                onEdit={() => onEditComment(comment.id)}
                onDelete={() => onDeleteComment(comment.id)}
              />
            )}
          </div>
        );
      }
      if (!commentRange) return null;
      return (
        <DiffCommentComposer
          lineLabel={formatLineLabel(commentRange)}
          onSubmit={(comment) => onSubmitComment(file, commentRange, comment)}
          onCancel={onCancelComment}
        />
      );
    },
    [
      file,
      commentRange,
      editingCommentId,
      onSubmitComment,
      onCancelComment,
      onEditComment,
      onUpdateComment,
      onDeleteComment,
    ],
  );

  return (
    <ErrorBoundary
      fallback={<div className={styles['render-error']}>Failed to render diff for this file</div>}
    >
      <FileDiff
        fileDiff={file}
        options={fileOptions}
        selectedLines={commentRange}
        lineAnnotations={annotations}
        renderAnnotation={renderAnnotation}
      />
    </ErrorBoundary>
  );
});

function FileStats({ stats }: { stats: FileChangeStats | undefined }) {
  if (!stats || (stats.additions === 0 && stats.deletions === 0)) return null;

  return (
    <span className={styles['file-stats']}>
      {stats.additions > 0 && <span className={styles['stat-add']}>+{stats.additions}</span>}
      {stats.deletions > 0 && <span className={styles['stat-del']}>&minus;{stats.deletions}</span>}
    </span>
  );
}

function FileStatusBadge({ type }: { type?: string }) {
  if (!type || type === 'change') return null;
  const label = STATUS_LABELS[type];
  const modifier = STATUS_BADGE_MODIFIERS[type];
  if (!label || !modifier) return null;

  return <span className={clsx(styles['status-badge'], modifier)}>{label}</span>;
}

export const DiffFileRow = memo(function DiffFileRow({
  file,
  contentKey,
  isExpanded,
  isReviewed,
  stats,
  canDiscard,
  discardPending,
  cwd,
  chatId,
  options,
  commentRange,
  isComposing,
  comments,
  editingCommentId,
  onToggle,
  onToggleReviewed,
  onDiscard,
  onSelectionChange,
  onSelectionEnd,
  onSubmitComment,
  onCancelComment,
  onEditComment,
  onUpdateComment,
  onDeleteComment,
}: {
  file: FileDiffMetadata;
  contentKey: string | undefined;
  isExpanded: boolean;
  isReviewed: boolean;
  stats: FileChangeStats | undefined;
  canDiscard: boolean;
  discardPending: boolean;
  cwd: string | undefined;
  chatId: string | undefined;
  options: Record<string, unknown>;
  commentRange: SelectedLineRange | null;
  isComposing: boolean;
  comments: DiffComment[];
  editingCommentId: string | null;
  onToggle: (name: string) => void;
  onToggleReviewed: (name: string) => void;
  onDiscard: (file: FileDiffMetadata) => void;
  onSelectionChange: (fileName: string, range: SelectedLineRange | null) => void;
  onSelectionEnd: (fileName: string, range: SelectedLineRange | null) => void;
  onSubmitComment: (file: FileDiffMetadata, range: SelectedLineRange, comment: string) => void;
  onCancelComment: () => void;
  onEditComment: (id: string | null) => void;
  onUpdateComment: (id: string, body: string) => void;
  onDeleteComment: (id: string) => void;
}) {
  const isRenamed = isRenameFileType(file.type);
  return (
    <div data-diff-file-path={file.name}>
      <div className={clsx(styles.header, isExpanded && styles['header--expanded'])}>
        <Button
          variant="unstyled"
          type="button"
          onClick={() => onToggle(file.name)}
          className={styles.toggle}
        >
          <ChevronRight
            className={clsx(styles.chevron, isExpanded && styles['chevron--expanded'])}
          />
          <FileIcon name={file.name} className={styles['file-icon']} />
          <span className={styles['file-name']}>
            {isRenamed && file.prevName ? (
              <>
                <span className={styles['prev-name']}>{file.prevName}</span>
                <span className={styles['rename-arrow']}>&rarr;</span>
                {file.name}
              </>
            ) : (
              file.name
            )}
          </span>
          <FileStatusBadge type={file.type} />
        </Button>
        {file.type !== 'deleted' && (
          <FloatingTooltip content="Open in editor" className={styles['action-slot']}>
            <Button
              variant="unstyled"
              type="button"
              onClick={() =>
                useUIStore
                  .getState()
                  .openFileInEditor(cwd ? `${cwd}/${file.name}` : file.name, chatId)
              }
              className={styles['file-action']}
              aria-label={`Open ${file.name} in editor`}
            >
              <ExternalLink className={styles['action-icon']} />
            </Button>
          </FloatingTooltip>
        )}
        {canDiscard && (
          <FloatingTooltip content="Discard changes" className={styles['action-slot']}>
            <Button
              variant="unstyled"
              type="button"
              onClick={() => onDiscard(file)}
              disabled={discardPending}
              className={styles['file-action']}
              aria-label={`Discard changes for ${file.name}`}
            >
              <Undo2 className={styles['action-icon']} />
            </Button>
          </FloatingTooltip>
        )}
        <FileStats stats={stats} />
        <Button
          variant="unstyled"
          type="button"
          role="checkbox"
          aria-checked={isReviewed}
          aria-label={`Viewed ${file.name}`}
          onClick={() => onToggleReviewed(file.name)}
          className={clsx(styles.viewed, isReviewed && styles['viewed--checked'])}
        >
          {isReviewed ? (
            <SquareCheck className={styles['viewed-icon']} />
          ) : (
            <Square className={styles['viewed-icon']} />
          )}
          Viewed
        </Button>
      </div>
      {isExpanded && (
        // Keyed by content hash — the library's VirtualizedFileDiff ignores a
        // new fileDiff after hydration (`this.fileDiff ??= fileDiff`), so a
        // refetch with changed content must remount to render fresh lines.
        <FileDiffRenderer
          key={contentKey}
          file={file}
          options={options}
          canComment={!!chatId}
          commentRange={commentRange}
          isComposing={isComposing}
          comments={comments}
          editingCommentId={editingCommentId}
          onSelectionChange={onSelectionChange}
          onSelectionEnd={onSelectionEnd}
          onSubmitComment={onSubmitComment}
          onCancelComment={onCancelComment}
          onEditComment={onEditComment}
          onUpdateComment={onUpdateComment}
          onDeleteComment={onDeleteComment}
        />
      )}
    </div>
  );
});
