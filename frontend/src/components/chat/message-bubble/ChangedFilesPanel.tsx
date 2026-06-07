import { Fragment, memo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Files,
  GitCompareArrows,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { DiffView } from '@/components/chat/tools/common/DiffView';
import { useMessageChangesQuery, useMessageFileDiffQuery } from '@/hooks/queries/useChatQueries';
import { useUIStore } from '@/store/uiStore';
import { useChatContext } from '@/hooks/useChatContext';
import type { ChangedFile, ChangedFileStatus } from '@/types/sandbox.types';

interface ChangedFilesPanelProps {
  messageId: string;
}

const STATUS_LABEL: Record<ChangedFileStatus, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
};

const STATUS_COLOR: Record<ChangedFileStatus, string> = {
  M: 'text-text-quaternary dark:text-text-dark-quaternary',
  A: 'text-success-600 dark:text-success-400',
  D: 'text-error-600 dark:text-error-400',
};

const ChangedFilesPanelInner: React.FC<ChangedFilesPanelProps> = ({ messageId }) => {
  const [expanded, setExpanded] = useState(false);
  const { data } = useMessageChangesQuery(messageId);

  const files = data?.files ?? [];
  const cwd = data?.cwd ?? '';
  if (files.length === 0) return null;

  const { totalAdditions, totalDeletions } = files.reduce(
    (acc, f) => {
      acc.totalAdditions += f.additions;
      acc.totalDeletions += f.deletions;
      return acc;
    },
    { totalAdditions: 0, totalDeletions: 0 },
  );

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border/50 bg-surface-secondary dark:border-border-dark/50 dark:bg-surface-dark-secondary">
      <Button
        type="button"
        variant="unstyled"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-surface-hover dark:hover:bg-surface-dark-hover"
      >
        <Files className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary dark:text-text-dark-tertiary" />
        <span className="text-xs font-medium text-text-secondary dark:text-text-dark-secondary">
          {files.length} {files.length === 1 ? 'file' : 'files'} changed
        </span>
        <span className="text-text-quaternary dark:text-text-dark-quaternary">·</span>
        <span className="font-mono text-xs tabular-nums text-success-600 dark:text-success-400">
          +{totalAdditions}
        </span>
        <span className="font-mono text-xs tabular-nums text-error-600 dark:text-error-400">
          −{totalDeletions}
        </span>
        <div className="flex-1" />
        <ChevronDown
          className={`h-3.5 w-3.5 flex-shrink-0 text-text-quaternary transition-transform duration-300 ease-out dark:text-text-dark-quaternary ${expanded ? 'rotate-180' : ''}`}
        />
      </Button>

      {expanded && (
        <div className="border-t border-border/50 dark:border-border-dark/50">
          {files.map((file) => (
            <ChangedFileRow key={file.path} messageId={messageId} file={file} cwd={cwd} />
          ))}
        </div>
      )}
    </div>
  );
};

const ChangedFileRow: React.FC<{
  messageId: string;
  file: ChangedFile;
  cwd: string;
}> = ({ messageId, file, cwd }) => {
  // This row renders inside either chat pane; bind diff jumps to the pane's
  // chat so they open in (and are claimed by) that chat's own diff tile.
  const { chatId } = useChatContext();
  const [open, setOpen] = useState(false);
  const isDeleted = file.status === 'D';
  const editorPath = cwd ? `${cwd}/${file.path}` : file.path;

  return (
    <Fragment>
      <div className="flex w-full items-center gap-2 border-b border-border/50 px-3 py-2 transition-colors duration-150 last:border-b-0 hover:bg-surface-hover dark:border-border-dark/50 dark:hover:bg-surface-dark-hover">
        <Button
          type="button"
          variant="unstyled"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="h-3 w-3 flex-shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
          ) : (
            <ChevronRight className="h-3 w-3 flex-shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
          )}
          <span
            className={`w-3.5 flex-shrink-0 text-center font-mono text-2xs ${STATUS_COLOR[file.status]}`}
            title={STATUS_LABEL[file.status]}
          >
            {file.status}
          </span>
          <span
            className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary dark:text-text-dark-secondary"
            title={file.path}
          >
            {file.path}
          </span>
          <span className="flex-shrink-0 font-mono text-2xs tabular-nums text-success-600 dark:text-success-400">
            +{file.additions}
          </span>
          <span className="flex-shrink-0 font-mono text-2xs tabular-nums text-error-600 dark:text-error-400">
            −{file.deletions}
          </span>
        </Button>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="unstyled"
            onClick={() => chatId && useUIStore.getState().openInDiffView(file.path, chatId)}
            aria-label="Open in diff view"
            title="Open in diff view"
            className="text-text-quaternary transition-colors duration-150 hover:text-text-primary dark:text-text-dark-quaternary dark:hover:text-text-dark-primary"
          >
            <GitCompareArrows className="h-3 w-3" />
          </Button>
          {!isDeleted && (
            <Button
              type="button"
              variant="unstyled"
              onClick={() => useUIStore.getState().openFileInEditor(editorPath, chatId)}
              aria-label="Open in editor"
              title="Open in editor"
              className="text-text-quaternary transition-colors duration-150 hover:text-text-primary dark:text-text-dark-quaternary dark:hover:text-text-dark-primary"
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      {open && <FileDiffSection messageId={messageId} path={file.path} />}
    </Fragment>
  );
};

const FileDiffSection: React.FC<{
  messageId: string;
  path: string;
}> = ({ messageId, path }) => {
  const { data, isLoading, isError } = useMessageFileDiffQuery(messageId, path);

  return (
    <div className="bg-surface-primary dark:bg-surface-dark-primary border-b border-border/50 px-3 py-2 last:border-b-0 dark:border-border-dark/50">
      {isLoading && (
        <div className="flex items-center gap-2 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading diff…
        </div>
      )}
      {isError && (
        <div className="text-2xs text-error-600 dark:text-error-400">Failed to load diff</div>
      )}
      {data &&
        (data.diff.trim().length > 0 ? (
          <DiffView diff={data.diff} />
        ) : (
          <div className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
            No textual diff available
          </div>
        ))}
    </div>
  );
};

export const ChangedFilesPanel = memo(ChangedFilesPanelInner);
