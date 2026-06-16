import { memo, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { useToggleSet } from '@/hooks/useToggleSet';
import {
  AlertCircle,
  ChevronRight,
  ChevronsUpDown,
  ExternalLink,
  GitCompareArrows,
  MoreHorizontal,
  RotateCcw,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { FileIcon } from '@/components/ui/shared/FileIcon';
import { Button } from '@/components/ui/primitives/Button';
import { SegmentedControl } from '@/components/ui/primitives/SegmentedControl';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import {
  useGitDiffQuery,
  useGitRestoreAllMutation,
  useGitRestoreFileMutation,
} from '@/hooks/queries/useSandboxQueries';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useUIStore } from '@/store/uiStore';
import { parsePatchFiles, parseDiffFromFile } from '@pierre/diffs';
import type { FileDiffMetadata, FileContents } from '@pierre/diffs';
import { FileDiff, Virtualizer, WorkerPoolContextProvider } from '@pierre/diffs/react';
import type { WorkerPoolOptions, WorkerInitializationRenderOptions } from '@pierre/diffs/worker';
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker';
import type { DiffMode } from '@/types/sandbox.types';
import { cn } from '@/utils/cn';

const DIFF_THEMES = { dark: 'pierre-dark', light: 'pierre-light' } as const;

// Library snapshots these on first mount — must stay reference-stable.
const WORKER_POOL_OPTIONS: WorkerPoolOptions = {
  workerFactory: () => new DiffsWorker(),
  // 2 workers covers "expand all" without a thread per CPU.
  poolSize: 2,
};
const WORKER_HIGHLIGHTER_OPTIONS: WorkerInitializationRenderOptions = {};

const DIFF_MODE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'staged', label: 'Staged' },
  { value: 'unstaged', label: 'Unstaged' },
  { value: 'branch', label: 'Branch' },
] satisfies { value: DiffMode; label: string }[];

const DIFF_STYLE_OPTIONS = [
  { value: 'unified', label: 'Unified' },
  { value: 'split', label: 'Split' },
] satisfies { value: 'unified' | 'split'; label: string }[];

const DIFF_EMPTY_LABELS: Record<DiffMode, string> = {
  all: 'No changes',
  staged: 'No staged changes',
  unstaged: 'No unstaged changes',
  branch: 'No changes from base branch',
};

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

const MENU_ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-text-secondary transition-colors duration-200 hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50 dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover';

// 6px below trigger, right-aligned — shared by open + reposition handlers.
const computeMenuPos = (rect: DOMRect) => ({
  top: rect.bottom + 6,
  right: window.innerWidth - rect.right,
});

const isRenameFileType = (type?: string) => type === 'rename-pure' || type === 'rename-changed';

// Backend always sends full-context diffs, so deletion/additionLines hold the
// complete bodies. Lines keep trailing '\n', so raw join reconstructs the file.
function extractContents(
  file: FileDiffMetadata,
): { oldContent: string; newContent: string } | null {
  if (file.deletionLines.length === 0 && file.additionLines.length === 0) return null;
  return {
    oldContent: file.deletionLines.join(''),
    newContent: file.additionLines.join(''),
  };
}

function hashDiffContent(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

// Re-diff with limited context so the library emits collapsedBefore gaps for
// the expand-on-click UI.
function rebuildWithCollapsedContext(
  fullFile: FileDiffMetadata,
  parseDiffFromFile: (old: FileContents, cur: FileContents) => FileDiffMetadata,
): FileDiffMetadata {
  const contents = extractContents(fullFile);
  if (!contents) return fullFile;
  const rebuilt = parseDiffFromFile(
    {
      name: fullFile.prevName ?? fullFile.name,
      contents: contents.oldContent,
      cacheKey: fullFile.cacheKey ? `${fullFile.cacheKey}:old` : undefined,
    },
    {
      name: fullFile.name,
      contents: contents.newContent,
      cacheKey: fullFile.cacheKey ? `${fullFile.cacheKey}:new` : undefined,
    },
  );
  rebuilt.type = fullFile.type;
  rebuilt.prevName = fullFile.prevName;
  if (fullFile.mode) rebuilt.mode = fullFile.mode;
  if (fullFile.oldMode) rebuilt.oldMode = fullFile.oldMode;
  return rebuilt;
}

function DiffEmptyState({
  icon: Icon,
  label,
  sublabel,
  children,
}: {
  icon: LucideIcon;
  label: string;
  sublabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <Icon className="h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
      <span className="text-xs text-text-tertiary dark:text-text-dark-tertiary">{label}</span>
      {sublabel && (
        <span className="text-2xs text-text-quaternary dark:text-text-dark-quaternary">
          {sublabel}
        </span>
      )}
      {children}
    </div>
  );
}

function FileDiffRenderer({
  file,
  options,
}: {
  file: FileDiffMetadata;
  options: Record<string, unknown>;
}) {
  return (
    <ErrorBoundary
      fallback={
        <div className="px-3 py-4 text-xs text-error-600 dark:text-error-400">
          Failed to render diff for this file
        </div>
      }
    >
      <FileDiff fileDiff={file} options={options} />
    </ErrorBoundary>
  );
}

function FileStats({ file }: { file: FileDiffMetadata }) {
  const { hunks } = file;
  if (hunks.length === 0) return null;

  let additions = 0;
  let deletions = 0;
  for (const h of hunks) {
    additions += h.additionLines;
    deletions += h.deletionLines;
  }

  if (additions === 0 && deletions === 0) return null;

  return (
    <span className="flex shrink-0 items-center gap-1.5 pr-3 font-mono text-2xs">
      {additions > 0 && (
        <span className="text-success-600 dark:text-success-400">+{additions}</span>
      )}
      {deletions > 0 && (
        <span className="text-error-600 dark:text-error-400">&minus;{deletions}</span>
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

interface DiffViewProps {
  // The chat this tile renders — resolves the sandbox/cwd it diffs and binds it
  // to jumps so the primary and secondary diff tiles never consume each other's.
  chatId: string | undefined;
}

export const DiffView = memo(function DiffView({ chatId }: DiffViewProps) {
  const theme = useResolvedTheme();
  const { data: chat } = useChatQuery(chatId);
  const sandboxId = chat?.sandbox_id ?? undefined;
  const cwd = chat?.worktree_cwd ?? undefined;
  const [expandedFiles, toggleFile, setExpandedFiles] = useToggleSet<string>();
  const [mode, setMode] = useState<DiffMode>('all');
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified');
  const [discardTarget, setDiscardTarget] = useState<FileDiffMetadata | null>(null);
  const [discardAllOpen, setDiscardAllOpen] = useState(false);

  const {
    data: diffData,
    isFetching,
    isError,
    isPlaceholderData,
    refetch,
  } = useGitDiffQuery(sandboxId, mode, true, cwd, { enabled: !!sandboxId });

  const restoreFile = useGitRestoreFileMutation();
  const restoreAll = useGitRestoreAllMutation();

  // Scopes the jump-scroll query to this tile's DOM — both diff tiles emit
  // identical data-diff-file-path attributes, so a document-wide query could
  // target the other tile.
  const rootRef = useRef<HTMLDivElement>(null);

  // Filename keys persist across refetches, but mean different content across
  // scopes — reset on scope change. Ref check avoids a double render. Discard
  // dialog state is cleared too so a confirm can't act on the prior scope's file.
  const scopeKey = `${sandboxId ?? ''}\0${cwd ?? ''}\0${mode}`;
  const prevScopeRef = useRef(scopeKey);
  if (prevScopeRef.current !== scopeKey) {
    prevScopeRef.current = scopeKey;
    setExpandedFiles(new Set());
    setDiscardTarget(null);
    setDiscardAllOpen(false);
  }

  // Portal escapes the toolbar's overflow-x-auto clip (CSS clips both axes).
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 });

  const toggleMenu = useCallback(() => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    setMenuPos(computeMenuPos(trigger.getBoundingClientRect()));
    setMenuOpen(true);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuPanelRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    // Resize only — document scroll thrashes layout, and any real scroll
    // closes the menu via the mousedown handler anyway.
    const reposition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      setMenuPos(computeMenuPos(trigger.getBoundingClientRect()));
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', reposition);
    };
  }, [menuOpen]);

  const handleDiscard = useCallback(async () => {
    if (!sandboxId || !discardTarget) return;
    const file = discardTarget;
    try {
      const result = await restoreFile.mutateAsync({
        sandboxId,
        filePath: file.name,
        oldPath: isRenameFileType(file.type) ? file.prevName : undefined,
        cwd,
      });
      if (result.success) {
        toast.success('Changes discarded');
      } else {
        toast.error(result.error || 'Failed to discard changes');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to discard changes');
    }
  }, [sandboxId, discardTarget, cwd, restoreFile]);

  const handleDiscardAll = useCallback(async () => {
    if (!sandboxId) return;
    try {
      const result = await restoreAll.mutateAsync({ sandboxId, cwd });
      if (result.success) {
        toast.success('All changes discarded');
      } else {
        toast.error(result.error || 'Failed to discard all changes');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to discard all changes');
    }
  }, [sandboxId, cwd, restoreAll]);

  const diffContent = diffData?.diff ?? '';
  const diffCacheKey = useMemo(
    () => (diffContent ? `${scopeKey}\0${hashDiffContent(diffContent)}` : undefined),
    [diffContent, scopeKey],
  );

  const parsedFiles = useMemo<FileDiffMetadata[]>(() => {
    if (!diffContent) return [];
    return (
      parsePatchFiles(diffContent, diffCacheKey)
        .flatMap((p) => p.files)
        // No unchanged context on new/deleted — skip the re-diff.
        .map((f) =>
          f.type === 'new' || f.type === 'deleted'
            ? f
            : rebuildWithCollapsedContext(f, parseDiffFromFile),
        )
    );
  }, [diffContent, diffCacheKey]);

  const options = useMemo(
    () => ({
      theme: DIFF_THEMES,
      themeType: theme,
      diffStyle,
      expandUnchanged: false,
      disableFileHeader: true,
    }),
    [theme, diffStyle],
  );

  // External request (from ChangedFilesPanel "open in diff view") to focus a
  // specific file. Best-effort match against parsedFiles — exact, then suffix
  // either way to absorb cwd/repo-root prefix differences.
  const pendingDiffFile = useUIStore((s) => s.pendingDiffFile);
  useEffect(() => {
    // Ignore jumps bound to a different chat so this tile can't consume one
    // meant for the other diff tile (or a since-replaced chat in this slot).
    if (!pendingDiffFile || pendingDiffFile.chatId !== chatId) return;
    // Wait for fresh rows — placeholder rows belong to the previous scope.
    if (parsedFiles.length === 0 || isPlaceholderData) return;
    const path = pendingDiffFile.path;
    const match =
      parsedFiles.find((f) => f.name === path) ??
      parsedFiles.find((f) => f.name.endsWith(path) || path.endsWith(f.name));
    if (match) {
      setExpandedFiles((prev) => {
        if (prev.has(match.name)) return prev;
        const next = new Set(prev);
        next.add(match.name);
        return next;
      });
      requestAnimationFrame(() => {
        const el = rootRef.current?.querySelector(
          `[data-diff-file-path="${CSS.escape(match.name)}"]`,
        );
        el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }
    useUIStore.getState().consumeDiffFileJump();
  }, [pendingDiffFile, parsedFiles, setExpandedFiles, chatId, isPlaceholderData]);

  const allExpanded = parsedFiles.length > 0 && parsedFiles.every((f) => expandedFiles.has(f.name));

  const toggleAll = useCallback(() => {
    setExpandedFiles((prev) => {
      const allOn = parsedFiles.length > 0 && parsedFiles.every((f) => prev.has(f.name));
      if (allOn) return new Set();
      return new Set(parsedFiles.map((f) => f.name));
    });
  }, [parsedFiles, setExpandedFiles]);

  if (!sandboxId) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-secondary text-xs text-text-quaternary dark:bg-surface-dark-secondary dark:text-text-dark-quaternary">
        No sandbox connected
      </div>
    );
  }

  const isLoading = isFetching && !diffData;
  const isGitRepo = diffData?.is_git_repo ?? false;
  const hasChanges = diffData?.has_changes ?? false;
  const diffError = diffData?.error ?? null;
  const ready = !isLoading && !isError && isGitRepo;
  const showFiles = ready && hasChanges && parsedFiles.length > 0;
  // Discard restores against HEAD — only coherent in `all` mode.
  // `!isPlaceholderData` blocks acting on rows from the previous mode's fetch.
  const canDiscard = ready && hasChanges && mode === 'all' && !isPlaceholderData;

  return (
    <WorkerPoolContextProvider
      poolOptions={WORKER_POOL_OPTIONS}
      highlighterOptions={WORKER_HIGHLIGHTER_OPTIONS}
    >
      <div
        ref={rootRef}
        className="flex h-full w-full flex-col bg-surface-secondary dark:bg-surface-dark-secondary"
      >
        <div className="flex h-9 items-center gap-1.5 overflow-x-auto border-b border-border/50 px-3 [scrollbar-width:none] dark:border-border-dark/50 [&::-webkit-scrollbar]:hidden">
          <Button
            onClick={() => refetch()}
            variant="unstyled"
            className="shrink-0 rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
            title="Refresh diff"
            aria-label="Refresh diff"
          >
            <RotateCcw
              className={cn('h-3 w-3', isFetching && 'animate-spin motion-reduce:animate-none')}
            />
          </Button>

          <SegmentedControl
            options={DIFF_MODE_OPTIONS}
            value={mode}
            onChange={setMode}
            size="sm"
            className="shrink-0"
          />

          <div className="min-w-0 flex-1" />

          {(showFiles || canDiscard) && (
            <>
              <Button
                ref={triggerRef}
                onClick={toggleMenu}
                variant="unstyled"
                className="shrink-0 rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
                title="More actions"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <MoreHorizontal className="h-3 w-3" />
              </Button>
              {menuOpen &&
                createPortal(
                  <div
                    ref={menuPanelRef}
                    role="menu"
                    style={{ top: menuPos.top, right: menuPos.right }}
                    className="fixed z-50 min-w-[180px] animate-fade-in space-y-px rounded-xl border border-border bg-surface-secondary/95 p-1 shadow-medium backdrop-blur-xl backdrop-saturate-150 dark:border-border-dark dark:bg-surface-dark-secondary/95"
                  >
                    {showFiles && (
                      <Button
                        variant="unstyled"
                        role="menuitem"
                        onClick={() => {
                          toggleAll();
                          setMenuOpen(false);
                        }}
                        className={MENU_ITEM_CLASS}
                      >
                        <ChevronsUpDown className="h-3 w-3 text-text-tertiary dark:text-text-dark-tertiary" />
                        {allExpanded ? 'Collapse all files' : 'Expand all files'}
                      </Button>
                    )}
                    {showFiles && canDiscard && (
                      <div className="my-1 h-px bg-border/50 dark:bg-border-dark/50" />
                    )}
                    {canDiscard && (
                      <Button
                        variant="unstyled"
                        role="menuitem"
                        disabled={restoreAll.isPending}
                        onClick={() => {
                          setDiscardAllOpen(true);
                          setMenuOpen(false);
                        }}
                        className={MENU_ITEM_CLASS}
                      >
                        <Undo2 className="h-3 w-3 text-text-tertiary dark:text-text-dark-tertiary" />
                        Discard all changes
                      </Button>
                    )}
                  </div>,
                  document.body,
                )}
              <div className="h-3 w-px shrink-0 bg-border/50 dark:bg-border-dark/50" />
            </>
          )}

          <SegmentedControl
            options={DIFF_STYLE_OPTIONS}
            value={diffStyle}
            onChange={setDiffStyle}
            size="sm"
            className="shrink-0"
          />
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {isLoading && (
            <div className="flex h-full items-center justify-center">
              <Spinner size="md" className="text-text-quaternary dark:text-text-dark-quaternary" />
            </div>
          )}

          {!isLoading && isError && (
            <DiffEmptyState icon={AlertCircle} label="Failed to load diff">
              <Button
                onClick={() => refetch()}
                variant="unstyled"
                className="text-2xs text-text-tertiary underline transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-tertiary dark:hover:text-text-dark-secondary"
              >
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
            <Virtualizer
              className="h-full w-full overflow-auto"
              contentClassName="divide-y divide-border/30 dark:divide-border-dark/30"
            >
              {parsedFiles.map((file) => {
                const isExpanded = expandedFiles.has(file.name);
                const isRenamed = isRenameFileType(file.type);
                return (
                  <div key={file.name} data-diff-file-path={file.name}>
                    <div className="group flex w-full items-center transition-colors duration-200 hover:bg-surface-hover dark:hover:bg-surface-dark-hover">
                      <Button
                        variant="unstyled"
                        type="button"
                        onClick={() => toggleFile(file.name)}
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
                        <Button
                          variant="unstyled"
                          type="button"
                          onClick={() =>
                            useUIStore
                              .getState()
                              .openFileInEditor(cwd ? `${cwd}/${file.name}` : file.name, chatId)
                          }
                          className="mr-1 shrink-0 rounded-md p-1 text-text-quaternary opacity-0 transition-opacity duration-200 hover:text-text-primary focus-visible:opacity-100 group-hover:opacity-100 dark:text-text-dark-quaternary dark:hover:text-text-dark-primary"
                          title="Open in editor"
                          aria-label={`Open ${file.name} in editor`}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      )}
                      {canDiscard && (
                        <Button
                          variant="unstyled"
                          type="button"
                          onClick={() => setDiscardTarget(file)}
                          disabled={restoreFile.isPending}
                          className="mr-1 shrink-0 rounded-md p-1 text-text-quaternary opacity-0 transition-opacity duration-200 hover:text-text-primary focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-50 group-hover:opacity-100 dark:text-text-dark-quaternary dark:hover:text-text-dark-primary"
                          title="Discard changes"
                          aria-label={`Discard changes for ${file.name}`}
                        >
                          <Undo2 className="h-3 w-3" />
                        </Button>
                      )}
                      <FileStats file={file} />
                    </div>
                    {isExpanded && <FileDiffRenderer file={file} options={options} />}
                  </div>
                );
              })}
            </Virtualizer>
          )}

          {ready && hasChanges && parsedFiles.length === 0 && (
            <DiffEmptyState
              icon={GitCompareArrows}
              label="Changes detected but diff cannot be displayed"
              sublabel="Binary or unsupported file formats"
            />
          )}
        </div>

        <ConfirmDialog
          isOpen={discardTarget !== null}
          onClose={() => setDiscardTarget(null)}
          onConfirm={handleDiscard}
          title="Discard changes?"
          message={
            discardTarget
              ? `All changes to ${discardTarget.name} will be reverted to the last committed version. This cannot be undone.`
              : ''
          }
          confirmLabel="Discard"
        />

        <ConfirmDialog
          isOpen={discardAllOpen}
          onClose={() => setDiscardAllOpen(false)}
          onConfirm={handleDiscardAll}
          title="Discard all changes?"
          message="All modified, staged, and untracked files in the workspace will be reverted to the last committed version. This cannot be undone."
          confirmLabel="Discard all"
        />
      </div>
    </WorkerPoolContextProvider>
  );
});
