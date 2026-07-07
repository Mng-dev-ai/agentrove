import { memo, useMemo, useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { useToggleSet } from '@/hooks/useToggleSet';
import { useAnchoredPanel } from '@/hooks/useAnchoredPanel';
import { useDiffReviewStore } from '@/store/diffReviewStore';
import {
  AlertCircle,
  ChevronDown,
  ChevronsUpDown,
  GitCompareArrows,
  MoreHorizontal,
  RotateCcw,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';
import { Button } from '@/components/ui/primitives/Button';
import { SegmentedControl } from '@/components/ui/primitives/SegmentedControl';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  useGitDiffQuery,
  useGitRestoreAllMutation,
  useGitRestoreFileMutation,
} from '@/hooks/queries/useSandboxQueries';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import { useFirstPaint } from '@/hooks/useFirstPaint';
import { viewLoadingFallback } from '@/components/ui/shared/ViewLoadingFallback';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { parsePatchFiles, parseDiffFromFile } from '@pierre/diffs';
import type { FileDiffMetadata, FileContents } from '@pierre/diffs';
import { DiffFileSidebar, type FileChangeStats } from '@/components/sandbox/git/DiffFileSidebar';
import { DiffFileRow, isRenameFileType } from '@/components/sandbox/git/DiffFileRow';
import { useDiffComments } from '@/hooks/useDiffComments';
import { Virtualizer, WorkerPoolContextProvider } from '@pierre/diffs/react';
import type { WorkerPoolOptions, WorkerInitializationRenderOptions } from '@pierre/diffs/worker';
import DiffsWorker from '@pierre/diffs/worker/worker.js?worker';
import type { DiffMode } from '@/types/sandbox.types';
import { cn } from '@/utils/cn';
// Per-palette pierre diff-surface overrides, generated from palettes.ts (see vite.config.ts).
import 'virtual:diff-palette-overrides.css';

const DIFF_THEMES = { dark: 'pierre-dark', light: 'pierre-light' } as const;

// Library snapshots these on first mount — must stay reference-stable.
const WORKER_POOL_OPTIONS: WorkerPoolOptions = {
  workerFactory: () => new DiffsWorker(),
  // 2 workers covers "expand all" without a thread per CPU.
  poolSize: 2,
};
const WORKER_HIGHLIGHTER_OPTIONS: WorkerInitializationRenderOptions = {};

// Wider pre-render halo than the library's 1000px default — fast scrolling
// through large files otherwise outruns rendering/highlighting (renders happen
// on scroll + rAF) and flashes unstyled text or striped buffer regions.
const VIRTUALIZER_CONFIG = { overscrollSize: 2500, intersectionObserverMargin: 10000 };

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

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

const DIFF_EMPTY_LABELS: Record<DiffMode, string> = {
  all: 'No changes',
  staged: 'No staged changes',
  unstaged: 'No unstaged changes',
  branch: 'No changes from base branch',
};

// The library washes annotation rows with the line-selection tint when they sit
// inside the selected range; keep the comment composer's row on the plain
// annotation background. Injected into the shadow root, where unlayered rules
// beat the library's @layer base styles.
const DIFF_UNSAFE_CSS =
  '[data-selected-line]:is([data-line-annotation],[data-gutter-buffer=annotation]){--diffs-computed-selected-line-bg:var(--diffs-annotation-bg)}';

// Below this tile width the sidebar can't coexist with a readable diff — it
// collapses into the toolbar file dropdown instead.
const NARROW_BREAKPOINT = 600;

const FILES_PANEL_WIDTH = 256;
const OVERFLOW_PANEL_WIDTH = 220;

// 6px below trigger, left-aligned, clamped so the panel stays on screen.
const computeMenuPos = (rect: DOMRect) => ({
  top: rect.bottom + 6,
  left: Math.max(8, Math.min(rect.left, window.innerWidth - FILES_PANEL_WIDTH - 8)),
});

// 6px below trigger, right-aligned to the trigger (overflow lives at the
// toolbar's right edge), clamped so the panel stays on screen.
const computeOverflowMenuPos = (rect: DOMRect) => ({
  top: rect.bottom + 6,
  left: Math.max(
    8,
    Math.min(rect.right - OVERFLOW_PANEL_WIDTH, window.innerWidth - OVERFLOW_PANEL_WIDTH - 8),
  ),
});

// Nearest scrollable ancestor, bounded to the diff pane — the Virtualizer owns
// the scroll container and doesn't expose a ref to it.
function findScroller(el: HTMLElement, boundary: HTMLElement | null): HTMLElement | null {
  for (let p = el.parentElement; p && p !== boundary; p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

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

interface DiffViewProps {
  // The chat this tile renders — resolves the sandbox/cwd it diffs and binds it
  // to jumps so the primary and secondary diff tiles never consume each other's.
  chatId: string | undefined;
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

const DiffViewContent = memo(function DiffViewContent({ chatId, isVisible }: DiffViewProps) {
  const theme = useResolvedTheme();
  const { data: chat } = useChatQuery(chatId);
  const sandboxId = chat?.sandbox_id ?? undefined;
  const cwd = chat?.worktree_cwd ?? undefined;
  // Files render expanded by default (continuous review scroll) — track the
  // exceptions the user collapsed instead of the ones they opened.
  const [collapsedFiles, toggleCollapsed, setCollapsedFiles] = useToggleSet<string>();
  const [mode, setMode] = useState<DiffMode>('all');
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified');
  const [discardTarget, setDiscardTarget] = useState<FileDiffMetadata | null>(null);
  const [discardAllOpen, setDiscardAllOpen] = useState(false);
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

  const restoreFile = useGitRestoreFileMutation();
  const restoreAll = useGitRestoreAllMutation();

  // Scopes the jump-scroll query to this tile's DOM — both diff tiles emit
  // identical data-diff-file-path attributes, so a document-wide query could
  // target the other tile.
  const rootRef = useRef<HTMLDivElement>(null);
  // Diff pane wrapper — its top edge is the scrollspy's reference line.
  const paneRef = useRef<HTMLDivElement>(null);
  // In-flight jump animation — a new click, scope change, or unmount cancels it.
  const jumpRafRef = useRef(0);
  const cancelJump = useCallback(() => {
    cancelAnimationFrame(jumpRafRef.current);
    jumpRafRef.current = 0;
  }, []);

  // Files we collapsed because they were marked reviewed. Tracked so we can tell
  // a review-collapse apart from a manual one and re-expand it if the ✓ later
  // invalidates (content changed) — the changed diff must not stay hidden.
  const reviewCollapsedRef = useRef<Set<string>>(new Set());
  // Latest collapsedFiles for reads inside the stable toggleReviewed callback,
  // so it can spot a pre-existing manual collapse without depending on the set.
  const collapsedFilesRef = useRef(collapsedFiles);
  collapsedFilesRef.current = collapsedFiles;

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

  // Closing a menu is a no-op when it isn't open, so every discard-all trigger
  // (toolbar, overflow menu, empty state) shares this handler.
  const openDiscardAll = useCallback(() => {
    setDiscardAllOpen(true);
    filesMenu.close();
    overflowMenu.close();
  }, [filesMenu.close, overflowMenu.close]);

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

  // path -> `path\0contentHash`. The hash folds a file's changed lines in, so a
  // key stored as "reviewed" stops matching once the file's content shifts.
  const reviewKeyByFile = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of parsedFiles) {
      const content = `${file.deletionLines.join('')}\0${file.additionLines.join('')}`;
      map.set(file.name, `${file.name}\0${hashDiffContent(content)}`);
    }
    return map;
  }, [parsedFiles]);

  // Persisted reviewed keys for this scope (survives reloads). Undefined until
  // the user marks anything, so default to empty.
  const reviewedKeys = useDiffReviewStore((s) => s.reviewedByScope[scopeKey]);

  // Names whose current key is marked reviewed — only ever holds live files, so
  // stale keys left behind by edits don't inflate the count.
  const reviewedNames = useMemo(() => {
    const stored = new Set(reviewedKeys ?? []);
    const names = new Set<string>();
    reviewKeyByFile.forEach((key, name) => {
      if (stored.has(key)) names.add(name);
    });
    return names;
  }, [reviewKeyByFile, reviewedKeys]);

  // Re-expand any review-collapsed file whose ✓ just invalidated (its content
  // changed, so reviewedNames dropped it). Render-phase reconcile — cheaper than
  // an effect, and self-terminating since each name is removed once reopened.
  if (reviewCollapsedRef.current.size > 0) {
    const reopen: string[] = [];
    reviewCollapsedRef.current.forEach((name) => {
      if (!reviewedNames.has(name)) reopen.push(name);
    });
    if (reopen.length > 0) {
      for (const name of reopen) reviewCollapsedRef.current.delete(name);
      setCollapsedFiles((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const name of reopen) if (next.delete(name)) changed = true;
        return changed ? next : prev;
      });
    }
  }

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

  const jumpToFile = useCallback(
    (name: string) => {
      setActiveFile(name);
      // Expanding to show the file releases our review-collapse claim on it.
      reviewCollapsedRef.current.delete(name);
      setCollapsedFiles((prev) => {
        if (!prev.has(name)) return prev;
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
      cancelJump();
      // rAF: a just-expanded file needs a render before its body has height.
      jumpRafRef.current = requestAnimationFrame(() => {
        const el = rootRef.current?.querySelector<HTMLElement>(
          `[data-diff-file-path="${CSS.escape(name)}"]`,
        );
        if (!el) return;
        const scroller = findScroller(el, paneRef.current);
        if (!scroller) return;
        // Hand-rolled animation instead of smooth scrollIntoView: the Virtualizer
        // reconciles estimated heights as content renders in, shifting the target
        // mid-flight — scrollIntoView animates to the position measured at call
        // time and lands on a neighboring file. Re-measuring every frame converges
        // on the live position; instant teleports are equally off the table since
        // the Virtualizer only renders from scroll/intersection events.
        let frames = 0;
        const step = () => {
          const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          if (Math.abs(delta) < 1) {
            scroller.scrollTop += delta;
            return;
          }
          scroller.scrollTop +=
            Math.sign(delta) * Math.min(Math.abs(delta), Math.max(Math.abs(delta) * 0.3, 24));
          // Frame cap so a target that never settles can't animate forever.
          if ((frames += 1) < 180) jumpRafRef.current = requestAnimationFrame(step);
        };
        step();
      });
    },
    [cancelJump, setCollapsedFiles],
  );

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

  // Scope changes must cancel before a stale frame can run against the new diff.
  useLayoutEffect(() => cancelJump, [cancelJump, scopeKey]);

  const allCollapsed =
    parsedFiles.length > 0 && parsedFiles.every((f) => collapsedFiles.has(f.name));

  const toggleAll = useCallback(() => {
    // A bulk collapse/expand is a user override — drop all review-collapse
    // ownership so a later un-review/invalidation won't fight the user's choice.
    reviewCollapsedRef.current = new Set();
    setCollapsedFiles((prev) => {
      const allOff = parsedFiles.length > 0 && parsedFiles.every((f) => prev.has(f.name));
      if (allOff) return new Set();
      return new Set(parsedFiles.map((f) => f.name));
    });
  }, [parsedFiles, setCollapsedFiles]);

  // Chevron/header toggle — manually changing a file's collapse hands ownership
  // back to the user, so drop our review-collapse claim on it first.
  const handleToggleCollapsed = useCallback(
    (name: string) => {
      reviewCollapsedRef.current.delete(name);
      toggleCollapsed(name);
    },
    [toggleCollapsed],
  );

  const toggleAllFromMenu = useCallback(() => {
    toggleAll();
    overflowMenu.close();
  }, [toggleAll, overflowMenu.close]);

  const toggleReviewed = useCallback(
    (name: string) => {
      const key = reviewKeyByFile.get(name);
      if (!key) return;
      const store = useDiffReviewStore.getState();
      const willReview = !(store.reviewedByScope[scopeKey]?.includes(key) ?? false);
      store.toggleReviewed(scopeKey, key);
      // Collapse on review / reopen on un-review, mirroring GitHub's "Viewed".
      if (willReview) {
        // Only auto-collapse (and claim it as ours) when the file isn't already
        // collapsed — a manual collapse must outlive a later un-review/invalidate.
        if (!collapsedFilesRef.current.has(name)) {
          reviewCollapsedRef.current.add(name);
          setCollapsedFiles((prev) => {
            if (prev.has(name)) return prev;
            const next = new Set(prev);
            next.add(name);
            return next;
          });
        }
      } else if (reviewCollapsedRef.current.delete(name)) {
        // Un-review reopens only the collapse we added, never a manual one.
        setCollapsedFiles((prev) => {
          if (!prev.has(name)) return prev;
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
      }
    },
    [reviewKeyByFile, scopeKey, setCollapsedFiles],
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

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !showFiles) return;
    const cancelKeyboardScroll = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) cancelJump();
    };
    // A user gesture means the click-initiated jump should yield immediately.
    root.addEventListener('pointerdown', cancelJump, { capture: true, passive: true });
    root.addEventListener('wheel', cancelJump, { capture: true, passive: true });
    root.addEventListener('keydown', cancelKeyboardScroll, { capture: true });
    return () => {
      root.removeEventListener('pointerdown', cancelJump, { capture: true });
      root.removeEventListener('wheel', cancelJump, { capture: true });
      root.removeEventListener('keydown', cancelKeyboardScroll, { capture: true });
    };
  }, [cancelJump, showFiles]);

  // Scrollspy — capture-phase because scroll doesn't bubble and the Virtualizer
  // owns the scroll container. The last header within 32px of the pane top wins,
  // so the active file flips as each sticky header reaches its pinned position.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !showFiles) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const pane = paneRef.current;
        if (!pane) return;
        const paneTop = pane.getBoundingClientRect().top;
        let current: string | null = null;
        const wrappers = pane.querySelectorAll<HTMLElement>('[data-diff-file-path]');
        for (const wrapper of wrappers) {
          if (wrapper.getBoundingClientRect().top - paneTop > 32) break;
          current = wrapper.dataset.diffFilePath ?? null;
        }
        // Trailing files shorter than the pane never reach the top reference
        // line — at the scroll end, highlight the last file instead.
        const last = wrappers[wrappers.length - 1];
        const scroller = last && findScroller(last, pane);
        if (scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
          current = last.dataset.diffFilePath ?? current;
        }
        if (current) setActiveFile(current);
      });
    };
    root.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll, { capture: true });
      if (raf) cancelAnimationFrame(raf);
    };
  }, [showFiles]);

  if (!sandboxId) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-secondary text-xs text-text-quaternary dark:bg-surface-dark-secondary dark:text-text-dark-quaternary">
        No sandbox connected
      </div>
    );
  }

  const filesSidebar = showFiles ? (
    <DiffFileSidebar
      files={parsedFiles}
      statsByFile={statsByFile}
      activeFile={currentFile}
      onSelectFile={selectFile}
      reviewedFiles={reviewedNames}
    />
  ) : null;

  // Diffstat surfaced in the toolbar so change size stays visible when the
  // sidebar is collapsed (narrow tiles) or scrolled away.
  const diffstat = showFiles ? (
    <div className="flex shrink-0 items-center gap-1.5 font-mono text-2xs">
      <span className="text-success-600 dark:text-success-400">+{totals.additions}</span>
      <span className="text-error-600 dark:text-error-400">&minus;{totals.deletions}</span>
    </div>
  ) : null;

  return (
    <WorkerPoolContextProvider
      poolOptions={WORKER_POOL_OPTIONS}
      highlighterOptions={WORKER_HIGHLIGHTER_OPTIONS}
    >
      <div
        ref={rootRefCallback}
        className="flex h-full w-full flex-col bg-surface-secondary dark:bg-surface-dark-secondary"
      >
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border/50 px-3 dark:border-border-dark/50">
          {/* Scope cluster — refresh + which changes to show. */}
          <FloatingTooltip content="Refresh diff" className="flex shrink-0">
            <Button
              onClick={() => refetch()}
              variant="unstyled"
              className="rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
              aria-label="Refresh diff"
            >
              <RotateCcw
                className={cn('h-3 w-3', isFetching && 'animate-spin motion-reduce:animate-none')}
              />
            </Button>
          </FloatingTooltip>

          <SegmentedControl
            options={DIFF_MODE_OPTIONS}
            value={mode}
            onChange={setMode}
            size="sm"
            className="shrink-0"
          />

          {/* Narrow tiles collapse the sidebar into this file switcher. */}
          {isNarrow && showFiles && currentFile && (
            <>
              <Button
                ref={filesMenu.triggerRef}
                onClick={filesMenu.toggle}
                variant="unstyled"
                aria-haspopup="menu"
                aria-expanded={filesMenu.isOpen}
                className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 transition-colors duration-200 hover:bg-surface-hover dark:hover:bg-surface-dark-hover"
              >
                <span className="max-w-36 truncate font-mono text-2xs text-text-secondary dark:text-text-dark-secondary">
                  {currentFile.slice(currentFile.lastIndexOf('/') + 1)}
                </span>
                <span className="shrink-0 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
                  {parsedFiles.findIndex((f) => f.name === currentFile) + 1}/{parsedFiles.length}
                </span>
                <ChevronDown
                  className={cn(
                    'h-3 w-3 shrink-0 text-text-quaternary transition-transform duration-200 dark:text-text-dark-quaternary',
                    filesMenu.isOpen && 'rotate-180',
                  )}
                />
              </Button>
              {filesMenu.isOpen &&
                createPortal(
                  <div
                    ref={filesMenu.panelRef}
                    style={{
                      top: filesMenu.pos.top,
                      left: filesMenu.pos.left,
                      width: FILES_PANEL_WIDTH,
                    }}
                    className="fixed z-50 flex max-h-96 animate-fade-in flex-col overflow-hidden rounded-xl border border-border bg-surface-secondary/95 shadow-medium backdrop-blur-xl backdrop-saturate-150 dark:border-border-dark dark:bg-surface-dark-secondary/95"
                  >
                    {filesSidebar}
                  </div>,
                  document.body,
                )}
            </>
          )}

          {/* Wide: diffstat sits beside the scope. Narrow: it's pushed right,
              next to the overflow menu (rendered after the spacer below). */}
          {!isNarrow && diffstat}

          <div className="min-w-0 flex-1" />

          {isNarrow && diffstat}

          {/* Review progress — a glanceable "how far through this diff am I".
              Hidden on narrow tiles where the toolbar is already tight. */}
          {!isNarrow && showFiles && (
            <div className="flex shrink-0 items-center gap-2">
              <div className="h-1 w-14 overflow-hidden rounded-full bg-surface-tertiary dark:bg-surface-dark-tertiary">
                <div
                  className="h-full rounded-full bg-text-primary transition-[width] duration-300 dark:bg-text-dark-primary"
                  style={{
                    width: `${parsedFiles.length > 0 ? (reviewedNames.size / parsedFiles.length) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="whitespace-nowrap text-2xs tabular-nums text-text-tertiary dark:text-text-dark-tertiary">
                {reviewedNames.size}/{parsedFiles.length} reviewed
              </span>
            </div>
          )}

          {/* Diff style stays inline on wide (the primary always-on preference);
              narrow tucks it into the overflow menu to save room. */}
          {!isNarrow && (
            <SegmentedControl
              options={DIFF_STYLE_OPTIONS}
              value={diffStyle}
              onChange={setDiffStyle}
              size="sm"
              className="shrink-0"
            />
          )}

          {/* Secondary actions (collapse/discard, plus diff style on narrow)
              live in one overflow menu instead of cryptic toolbar icons. On
              wide it only exists when there are files to act on. */}
          {(isNarrow || showFiles) && (
            <>
              <Button
                ref={overflowMenu.triggerRef}
                onClick={overflowMenu.toggle}
                variant="unstyled"
                aria-haspopup="menu"
                aria-expanded={overflowMenu.isOpen}
                aria-label="More diff options"
                className="shrink-0 rounded-md p-1 text-text-quaternary transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
              {overflowMenu.isOpen &&
                createPortal(
                  <div
                    ref={overflowMenu.panelRef}
                    style={{
                      top: overflowMenu.pos.top,
                      left: overflowMenu.pos.left,
                      width: OVERFLOW_PANEL_WIDTH,
                    }}
                    className="fixed z-50 flex animate-fade-in flex-col gap-0.5 overflow-hidden rounded-xl border border-border bg-surface-secondary/95 p-1 shadow-medium backdrop-blur-xl backdrop-saturate-150 dark:border-border-dark dark:bg-surface-dark-secondary/95"
                  >
                    {showFiles && (
                      <Button
                        variant="unstyled"
                        onClick={toggleAllFromMenu}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-2xs text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
                      >
                        <ChevronsUpDown className="h-3 w-3" />
                        {allCollapsed ? 'Expand all files' : 'Collapse all files'}
                      </Button>
                    )}
                    {showFiles && canDiscard && (
                      <Button
                        variant="unstyled"
                        disabled={restoreAll.isPending}
                        onClick={openDiscardAll}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-2xs text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
                      >
                        <Undo2 className="h-3 w-3" />
                        Discard all changes
                      </Button>
                    )}
                    {isNarrow && showFiles && (
                      <div className="mx-1 my-0.5 h-px bg-border/50 dark:bg-border-dark/50" />
                    )}
                    {isNarrow && (
                      <div className="flex items-center justify-between px-2 py-1">
                        <span className="text-2xs text-text-tertiary dark:text-text-dark-tertiary">
                          Diff style
                        </span>
                        <SegmentedControl
                          options={DIFF_STYLE_OPTIONS}
                          value={diffStyle}
                          onChange={setDiffStyle}
                          size="sm"
                        />
                      </div>
                    )}
                  </div>,
                  document.body,
                )}
            </>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          {!isNarrow && filesSidebar && (
            <div className="flex w-52 shrink-0 flex-col border-r border-border/50 dark:border-border-dark/50">
              {filesSidebar}
            </div>
          )}

          <div ref={paneRef} className="relative min-h-0 flex-1 overflow-hidden">
            {isLoading && (
              <div className="flex h-full items-center justify-center">
                <Spinner
                  size="md"
                  className="text-text-quaternary dark:text-text-dark-quaternary"
                />
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
              // overflow-anchor off: the library restores its own line-level
              // scroll anchor on height changes (composer row insert/remove),
              // and native anchoring double-corrects into a visible jump.
              // CodeView disables it on its root; plain Virtualizer doesn't.
              <Virtualizer
                config={VIRTUALIZER_CONFIG}
                className="h-full w-full overflow-auto [overflow-anchor:none]"
                contentClassName="divide-y divide-border/30 dark:divide-border-dark/30"
              >
                {parsedFiles.map((file) => (
                  <DiffFileRow
                    key={file.name}
                    file={file}
                    isExpanded={!collapsedFiles.has(file.name)}
                    isReviewed={reviewedNames.has(file.name)}
                    stats={statsByFile.get(file.name)}
                    canDiscard={canDiscard}
                    discardPending={restoreFile.isPending}
                    cwd={cwd}
                    chatId={chatId}
                    options={options}
                    commentRange={
                      pendingComment?.fileName === file.name ? pendingComment.range : null
                    }
                    isComposing={pendingComment?.fileName === file.name && pendingComment.composing}
                    onToggle={handleToggleCollapsed}
                    onToggleReviewed={toggleReviewed}
                    onDiscard={setDiscardTarget}
                    onSelectionChange={handleSelectionChange}
                    onSelectionEnd={handleSelectionEnd}
                    onSubmitComment={handleSubmitComment}
                    onCancelComment={resetComments}
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
                  <Button
                    onClick={openDiscardAll}
                    variant="unstyled"
                    className="text-2xs text-text-tertiary underline transition-colors duration-200 hover:text-text-secondary dark:text-text-dark-tertiary dark:hover:text-text-dark-secondary"
                  >
                    Discard all changes
                  </Button>
                )}
              </DiffEmptyState>
            )}
          </div>
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
