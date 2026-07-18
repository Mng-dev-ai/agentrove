import { memo, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useToggleSet } from '@/hooks/useToggleSet';
import { useAnchoredPanel } from '@/hooks/useAnchoredPanel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog/ConfirmDialog';
import { useGitDiffQuery } from '@/hooks/queries/useSandboxQueries';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import { useFirstPaint } from '@/hooks/useFirstPaint';
import { viewLoadingFallback } from '@/components/ui/shared/ViewLoadingFallback/ViewLoadingFallback';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { parsePatchFiles, parseDiffFromFile } from '@pierre/diffs';
import type { FileDiffMetadata } from '@pierre/diffs';
import {
  DiffFileSidebar,
  type FileChangeStats,
} from '@/components/sandbox/git/DiffFileSidebar/DiffFileSidebar';
import { useDiffComments } from '@/hooks/useDiffComments';
import { WorkerPoolContextProvider } from '@pierre/diffs/react';
import type { WorkerPoolOptions, WorkerInitializationRenderOptions } from '@pierre/diffs/worker';
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker';
import type { DiffMode } from '@/types/sandbox.types';
import { DiffPane } from './DiffPane';
import { DiffToolbar } from './DiffToolbar';
import { useDiffDiscard } from './useDiffDiscard';
import { useDiffReview } from './useDiffReview';
import { useDiffScroll } from './useDiffScroll';
import {
  DIFF_THEMES,
  DIFF_UNSAFE_CSS,
  NARROW_BREAKPOINT,
  compareFilePaths,
  computeMenuPos,
  computeOverflowMenuPos,
  hashDiffContent,
  rebuildWithCollapsedContext,
} from './diffView.utils';
import styles from './DiffView.module.scss';
// Per-palette pierre diff-surface overrides, generated from palettes.ts (see vite.config.ts).
import 'virtual:diff-palette-overrides.css';

// Library snapshots these on first mount — must stay reference-stable.
const WORKER_POOL_OPTIONS: WorkerPoolOptions = {
  workerFactory: () => new DiffsWorker(),
  // 2 workers covers "expand all" without a thread per CPU.
  poolSize: 2,
};
const WORKER_HIGHLIGHTER_OPTIONS: WorkerInitializationRenderOptions = {};

interface DiffViewProps {
  // The chat this tile renders — resolves the sandbox/cwd it diffs and binds it
  // to jumps so the primary and secondary diff tiles never consume each other's.
  chatId: string | undefined;
  // Chat-less contexts (the landing page) supply the sandbox directly — diffs run
  // at the workspace root and review comments are disabled (they need a chat).
  sandboxId?: string;
  // Whether this tile is currently on screen — background tiles stay mounted, so
  // visibility is how we know the user just switched to the diff view.
  isVisible: boolean;
}

export const DiffView = memo(function DiffView(props: DiffViewProps) {
  // Chat switches remount this tile with the lazy chunk already cached, so patch
  // parsing + pierre diff rendering would mount inside the navigation's commit
  // and block its first paint (same deferral as EditorPane).
  const hasPainted = useFirstPaint();

  if (!hasPainted) return viewLoadingFallback;
  return <DiffViewContent {...props} />;
});

const DiffViewContent = memo(function DiffViewContent({
  chatId,
  sandboxId: workspaceSandboxId,
  isVisible,
}: DiffViewProps) {
  const theme = useResolvedTheme();
  const { data: chat } = useChatQuery(chatId);
  const sandboxId = chat?.sandbox_id ?? workspaceSandboxId;
  const cwd = chat?.worktree_cwd ?? undefined;
  // Files render expanded by default (continuous review scroll) — track the
  // exceptions the user collapsed instead of the ones they opened.
  const [collapsedFiles, toggleCollapsed, setCollapsedFiles] = useToggleSet<string>();
  const [mode, setMode] = useState<DiffMode>('all');
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified');
  // Scrollspy target — the file whose diff currently tops the pane.
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const {
    pendingComment,
    resetComments,
    handleSelectionChange,
    handleSelectionEnd,
    handleSubmitComment,
  } = useDiffComments(chatId, cwd);

  const {
    data: diffData,
    isFetching,
    isError,
    isPlaceholderData,
    refetch,
  } = useGitDiffQuery(sandboxId, mode, true, cwd, { enabled: !!sandboxId });

  const {
    discardTarget,
    setDiscardTarget,
    discardAllOpen,
    setDiscardAllOpen,
    handleDiscard,
    handleDiscardAll,
    restoreFilePending,
    restoreAllPending,
  } = useDiffDiscard({ sandboxId, cwd });

  // Scopes the jump-scroll query to this tile's DOM — both diff tiles emit
  // identical data-diff-file-path attributes, so a document-wide query could
  // target the other tile.
  const rootRef = useRef<HTMLDivElement>(null);
  // Diff pane wrapper — its top edge is the scrollspy's reference line.
  const paneRef = useRef<HTMLDivElement>(null);

  // Files we collapsed because they were marked reviewed. Tracked so we can tell
  // a review-collapse apart from a manual one and re-expand it if the ✓ later
  // invalidates (content changed) — the changed diff must not stay hidden.
  const reviewCollapsedRef = useRef<Set<string>>(new Set());

  // Callback ref instead of an effect — the root div appears only once a
  // sandbox is connected, so a mount-only effect could observe nothing.
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const rootRefCallback = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (node) {
      const observer = new ResizeObserver(([entry]) => {
        setIsNarrow(entry.contentRect.width < NARROW_BREAKPOINT);
      });
      observer.observe(node);
      resizeObserverRef.current = observer;
    }
  }, []);

  // Filename keys persist across refetches, but mean different content across
  // scopes — reset on scope change. Ref check avoids a double render. Discard
  // dialog state is cleared too so a confirm can't act on the prior scope's file.
  const scopeKey = `${sandboxId ?? ''}\0${cwd ?? ''}\0${mode}`;
  const prevScopeRef = useRef(scopeKey);
  if (prevScopeRef.current !== scopeKey) {
    prevScopeRef.current = scopeKey;
    setCollapsedFiles(new Set());
    reviewCollapsedRef.current = new Set();
    setDiscardTarget(null);
    setDiscardAllOpen(false);
    setActiveFile(null);
    resetComments();
  }

  // Narrow-mode file dropdown, and the secondary-actions overflow menu — both
  // portaled to escape the toolbar's clip and stacking context.
  const filesMenu = useAnchoredPanel(computeMenuPos);
  const overflowMenu = useAnchoredPanel(computeOverflowMenuPos);

  // Closing a menu is a no-op when it isn't open, so every discard-all trigger
  // (toolbar, overflow menu, empty state) shares this handler.
  const openDiscardAll = useCallback(() => {
    setDiscardAllOpen(true);
    filesMenu.close();
    overflowMenu.close();
  }, [setDiscardAllOpen, filesMenu.close, overflowMenu.close]);

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
        .sort((a, b) => compareFilePaths(a.name, b.name))
    );
  }, [diffContent, diffCacheKey]);

  const statsByFile = useMemo(() => {
    const map = new Map<string, FileChangeStats>();
    for (const file of parsedFiles) {
      let additions = 0;
      let deletions = 0;
      for (const h of file.hunks) {
        additions += h.additionLines;
        deletions += h.deletionLines;
      }
      map.set(file.name, { additions, deletions });
    }
    return map;
  }, [parsedFiles]);

  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const stats of statsByFile.values()) {
      additions += stats.additions;
      deletions += stats.deletions;
    }
    return { additions, deletions };
  }, [statsByFile]);

  const {
    reviewKeyByFile,
    reviewedNames,
    allCollapsed,
    toggleAll,
    handleToggleCollapsed,
    toggleReviewed,
  } = useDiffReview({
    parsedFiles,
    scopeKey,
    isPlaceholder: isPlaceholderData,
    collapsedFiles,
    setCollapsedFiles,
    toggleCollapsed,
    reviewCollapsedRef,
  });

  // Refetches can drop the tracked file (e.g. after a discard) — fall back to
  // the first file so the sidebar highlight never points at a missing row.
  const currentFile =
    activeFile && statsByFile.has(activeFile) ? activeFile : (parsedFiles[0]?.name ?? null);

  const options = useMemo(
    () => ({
      theme: DIFF_THEMES,
      themeType: theme,
      diffStyle,
      expandUnchanged: false,
      disableFileHeader: true,
      unsafeCSS: DIFF_UNSAFE_CSS,
    }),
    [theme, diffStyle],
  );

  const isLoading = isFetching && !diffData;
  const isGitRepo = diffData?.is_git_repo ?? false;
  const hasChanges = diffData?.has_changes ?? false;
  const diffError = diffData?.error ?? null;
  const ready = !isLoading && !isError && isGitRepo;
  const showFiles = ready && hasChanges && parsedFiles.length > 0;
  // Discard restores against HEAD — only coherent in `all` mode.
  // `!isPlaceholderData` blocks acting on rows from the previous mode's fetch.
  const canDiscard = ready && hasChanges && mode === 'all' && !isPlaceholderData;

  const { jumpToFile } = useDiffScroll({
    rootRef,
    paneRef,
    scopeKey,
    showFiles,
    setActiveFile,
    setCollapsedFiles,
    reviewCollapsedRef,
  });

  const selectFile = useCallback(
    (name: string) => {
      jumpToFile(name);
      filesMenu.close();
    },
    [jumpToFile, filesMenu.close],
  );

  // The tile stays mounted while hidden, so switching back to it doesn't remount
  // or refetch. Force a refresh on each hidden→visible transition so the user
  // sees current changes without clicking refresh.
  const wasVisibleRef = useRef(isVisible);
  useEffect(() => {
    // Guard on sandboxId — imperative refetch() bypasses the query's enabled
    // gate, and getGitDiff throws on an undefined id.
    if (isVisible && !wasVisibleRef.current && sandboxId) refetch();
    wasVisibleRef.current = isVisible;
  }, [isVisible, refetch, sandboxId]);

  const toggleAllFromMenu = useCallback(() => {
    toggleAll();
    overflowMenu.close();
  }, [toggleAll, overflowMenu.close]);

  if (!sandboxId) {
    return <div className={styles['no-sandbox']}>No sandbox connected</div>;
  }

  const filesSidebar = showFiles ? (
    <DiffFileSidebar
      files={parsedFiles}
      statsByFile={statsByFile}
      totals={totals}
      activeFile={currentFile}
      onSelectFile={selectFile}
      reviewedFiles={reviewedNames}
    />
  ) : null;

  return (
    <WorkerPoolContextProvider
      poolOptions={WORKER_POOL_OPTIONS}
      highlighterOptions={WORKER_HIGHLIGHTER_OPTIONS}
    >
      <div ref={rootRefCallback} className={styles['diff-view']}>
        <DiffToolbar
          mode={mode}
          onModeChange={setMode}
          diffStyle={diffStyle}
          onDiffStyleChange={setDiffStyle}
          isFetching={isFetching}
          onRefetch={() => refetch()}
          isNarrow={isNarrow}
          showFiles={showFiles}
          currentFile={currentFile}
          parsedFiles={parsedFiles}
          totals={totals}
          reviewedCount={reviewedNames.size}
          canDiscard={canDiscard}
          discardAllPending={restoreAllPending}
          allCollapsed={allCollapsed}
          onToggleAll={toggleAllFromMenu}
          onDiscardAll={openDiscardAll}
          filesMenu={filesMenu}
          overflowMenu={overflowMenu}
          filesSidebar={filesSidebar}
        />

        <div className={styles.content}>
          {!isNarrow && filesSidebar && (
            <div className={styles['sidebar-pane']}>{filesSidebar}</div>
          )}

          <DiffPane
            paneRef={paneRef}
            isLoading={isLoading}
            isError={isError}
            isGitRepo={isGitRepo}
            ready={ready}
            diffError={diffError}
            hasChanges={hasChanges}
            mode={mode}
            showFiles={showFiles}
            parsedFiles={parsedFiles}
            onRefetch={() => refetch()}
            openDiscardAll={openDiscardAll}
            canDiscard={canDiscard}
            discardPending={restoreFilePending}
            reviewKeyByFile={reviewKeyByFile}
            collapsedFiles={collapsedFiles}
            reviewedNames={reviewedNames}
            statsByFile={statsByFile}
            cwd={cwd}
            chatId={chatId}
            options={options}
            pendingComment={pendingComment}
            onToggle={handleToggleCollapsed}
            onToggleReviewed={toggleReviewed}
            onDiscard={setDiscardTarget}
            onSelectionChange={handleSelectionChange}
            onSelectionEnd={handleSelectionEnd}
            onSubmitComment={handleSubmitComment}
            onCancelComment={resetComments}
          />
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
