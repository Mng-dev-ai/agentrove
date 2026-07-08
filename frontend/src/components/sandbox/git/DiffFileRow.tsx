import { memo, useMemo, useCallback } from 'react';
import { CheckCircle2, ChevronRight, Circle, ExternalLink, Undo2 } from 'lucide-react';
import { FileIcon } from '@/components/ui/shared/FileIcon';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { Button } from '@/components/ui/primitives/Button';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useUIStore } from '@/store/uiStore';
import type { FileDiffMetadata, SelectedLineRange, DiffLineAnnotation } from '@pierre/diffs';
import { DiffCommentComposer } from '@/components/sandbox/git/DiffCommentComposer';
import type { FileChangeStats } from '@/components/sandbox/git/DiffFileSidebar';
import { FileDiff } from '@pierre/diffs/react';
import { cn } from '@/utils/cn';

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  deleted: 'Deleted',
  'rename-pure': 'Renamed',
  'rename-changed': 'Renamed',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-success-600/15 text-success-600 dark:bg-success-400/15 dark:text-success-400',
  deleted: 'bg-error-600/15 text-error-600 dark:bg-error-400/15 dark:text-error-400',
  'rename-pure': 'bg-warning-600/15 text-warning-600 dark:bg-warning-400/15 dark:text-warning-400',
  'rename-changed':
    'bg-warning-600/15 text-warning-600 dark:bg-warning-400/15 dark:text-warning-400',
};

// Stable empty value — the library re-renders a file whenever the annotations
// array identity changes.
const NO_ANNOTATIONS: DiffLineAnnotation[] = [];

export const isRenameFileType = (type?: string) =>
  type === 'rename-pure' || type === 'rename-changed';

const FileDiffRenderer = memo(function FileDiffRenderer({
  file,
  options,
  canComment,
  commentRange,
  isComposing,
  onSelectionChange,
  onSelectionEnd,
  onSubmitComment,
  onCancelComment,
}: {
  file: FileDiffMetadata;
  options: Record<string, unknown>;
  canComment: boolean;
  commentRange: SelectedLineRange | null;
  isComposing: boolean;
  onSelectionChange: (fileName: string, range: SelectedLineRange | null) => void;
  onSelectionEnd: (fileName: string, range: SelectedLineRange | null) => void;
  onSubmitComment: (file: FileDiffMetadata, range: SelectedLineRange, comment: string) => void;
  onCancelComment: () => void;
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

  const annotations = useMemo<DiffLineAnnotation[]>(
    () =>
      isComposing && commentRange
        ? [
            {
              side: commentRange.endSide ?? commentRange.side ?? 'additions',
              lineNumber: commentRange.end,
            },
          ]
        : NO_ANNOTATIONS,
    [isComposing, commentRange],
  );

  const renderComposer = useCallback(() => {
    if (!commentRange) return null;
    return (
      <DiffCommentComposer
        lineLabel={
          commentRange.start === commentRange.end
            ? `line ${commentRange.start}`
            : `lines ${commentRange.start}-${commentRange.end}`
        }
        onSubmit={(comment) => onSubmitComment(file, commentRange, comment)}
        onCancel={onCancelComment}
      />
    );
  }, [file, commentRange, onSubmitComment, onCancelComment]);

  return (
    <ErrorBoundary
      fallback={
        <div className="px-3 py-4 text-xs text-error-600 dark:text-error-400">
          Failed to render diff for this file
        </div>
      }
    >
      <FileDiff
        fileDiff={file}
        options={fileOptions}
        selectedLines={commentRange}
        lineAnnotations={annotations}
        renderAnnotation={renderComposer}
      />
    </ErrorBoundary>
  );
});

function FileStats({ stats }: { stats: FileChangeStats | undefined }) {
  if (!stats || (stats.additions === 0 && stats.deletions === 0)) return null;

  return (
    <span className="flex shrink-0 items-center gap-1.5 pr-2 font-mono text-2xs">
      {stats.additions > 0 && (
        <span className="text-success-600 dark:text-success-400">+{stats.additions}</span>
      )}
      {stats.deletions > 0 && (
        <span className="text-error-600 dark:text-error-400">&minus;{stats.deletions}</span>
      )}
    </span>
  );
}

function FileStatusBadge({ type }: { type?: string }) {
  if (!type || type === 'change') return null;
  const label = STATUS_LABELS[type];
  const colors = STATUS_COLORS[type];
  if (!label || !colors) return null;

  return (
    <span
      className={cn('shrink-0 rounded px-1 py-0.5 text-[9px] font-medium leading-none', colors)}
    >
      {label}
    </span>
  );
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
  onToggle,
  onToggleReviewed,
  onDiscard,
  onSelectionChange,
  onSelectionEnd,
  onSubmitComment,
  onCancelComment,
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
  onToggle: (name: string) => void;
  onToggleReviewed: (name: string) => void;
  onDiscard: (file: FileDiffMetadata) => void;
  onSelectionChange: (fileName: string, range: SelectedLineRange | null) => void;
  onSelectionEnd: (fileName: string, range: SelectedLineRange | null) => void;
  onSubmitComment: (file: FileDiffMetadata, range: SelectedLineRange, comment: string) => void;
  onCancelComment: () => void;
}) {
  const isRenamed = isRenameFileType(file.type);
  return (
    <div data-diff-file-path={file.name}>
      <div
        className={cn(
          // Sticky header pins the filename while its diff scrolls;
          // opaque bg so diff lines don't bleed through.
          'group sticky top-0 z-10 flex w-full items-center bg-surface-secondary transition-colors duration-200 hover:bg-surface-hover dark:bg-surface-dark-secondary dark:hover:bg-surface-dark-hover',
          isExpanded && 'border-b border-border/30 dark:border-border-dark/30',
        )}
      >
        <Button
          variant="unstyled"
          type="button"
          onClick={() => onToggle(file.name)}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
        >
          <ChevronRight
            className={cn(
              'h-3 w-3 shrink-0 text-text-quaternary transition-transform duration-200 dark:text-text-dark-quaternary',
              isExpanded && 'rotate-90',
            )}
          />
          <FileIcon name={file.name} className="h-3 w-3" />
          <span className="min-w-0 truncate font-mono text-2xs text-text-secondary dark:text-text-dark-secondary">
            {isRenamed && file.prevName ? (
              <>
                <span className="text-text-quaternary dark:text-text-dark-quaternary">
                  {file.prevName}
                </span>
                <span className="mx-1 text-text-quaternary dark:text-text-dark-quaternary">
                  &rarr;
                </span>
                {file.name}
              </>
            ) : (
              file.name
            )}
          </span>
          <FileStatusBadge type={file.type} />
        </Button>
        {file.type !== 'deleted' && (
          <FloatingTooltip content="Open in editor" className="mr-1 flex shrink-0">
            <Button
              variant="unstyled"
              type="button"
              onClick={() =>
                useUIStore
                  .getState()
                  .openFileInEditor(cwd ? `${cwd}/${file.name}` : file.name, chatId)
              }
              className="rounded-md p-1 text-text-quaternary opacity-0 transition-opacity duration-200 hover:text-text-primary focus-visible:opacity-100 group-hover:opacity-100 dark:text-text-dark-quaternary dark:hover:text-text-dark-primary"
              aria-label={`Open ${file.name} in editor`}
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          </FloatingTooltip>
        )}
        {canDiscard && (
          <FloatingTooltip content="Discard changes" className="mr-1 flex shrink-0">
            <Button
              variant="unstyled"
              type="button"
              onClick={() => onDiscard(file)}
              disabled={discardPending}
              className="rounded-md p-1 text-text-quaternary opacity-0 transition-opacity duration-200 hover:text-text-primary focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-50 group-hover:opacity-100 dark:text-text-dark-quaternary dark:hover:text-text-dark-primary"
              aria-label={`Discard changes for ${file.name}`}
            >
              <Undo2 className="h-3 w-3" />
            </Button>
          </FloatingTooltip>
        )}
        <FileStats stats={stats} />
        <FloatingTooltip
          content={isReviewed ? 'Reviewed — click to unmark' : 'Mark as reviewed'}
          className="mr-3 flex shrink-0"
        >
          <Button
            variant="unstyled"
            type="button"
            onClick={() => onToggleReviewed(file.name)}
            aria-pressed={isReviewed}
            aria-label={
              isReviewed ? `Mark ${file.name} as not reviewed` : `Mark ${file.name} as reviewed`
            }
            className={cn(
              'rounded-md p-1 transition-colors duration-200',
              isReviewed
                ? 'text-success-600 dark:text-success-400'
                : 'text-text-quaternary hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary',
            )}
          >
            {isReviewed ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <Circle className="h-3.5 w-3.5" />
            )}
          </Button>
        </FloatingTooltip>
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
          onSelectionChange={onSelectionChange}
          onSelectionEnd={onSelectionEnd}
          onSubmitComment={onSubmitComment}
          onCancelComment={onCancelComment}
        />
      )}
    </div>
  );
});
