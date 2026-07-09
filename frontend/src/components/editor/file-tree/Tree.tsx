import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactNode,
  type Ref,
} from 'react';
import { flushSync } from 'react-dom';
import { FolderOpen } from 'lucide-react';
import { FileTree as PierreFileTree, useFileTree } from '@pierre/trees/react';
import type { FileTree } from '@pierre/trees';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import { useMountEffect } from '@/hooks/useMountEffect';
import type { FileStructure } from '@/types/file-system.types';
import {
  findFileInStructure,
  getAncestorFolderPaths,
  hasActualFiles,
  traverseFileStructure,
} from '@/utils/file';
import '@/styles/pierre-tree-theme.css';

const UNSAFE_CSS = `
  [data-file-tree-search-input] {
    --trees-focus-ring-width: 1px;
  }
`;

function focusPathWithTreeOwnership(
  model: FileTree,
  path: string,
  bouncePath: string | null,
): void {
  const root = model
    .getFileTreeContainer()
    ?.shadowRoot?.querySelector<HTMLElement>('[data-file-tree-virtualized-root]');
  if (!root) return;
  // pierre only scrolls focus changes when its root owns DOM focus.
  root.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  if (model.getFocusedPath() === path && bouncePath != null) {
    // pierre scrolls only when its focused path *changes* — re-focusing the already-focused
    // path emits nothing and the row stays off-screen. Hop focus through a visible neighbor;
    // flushSync commits each hop separately so the return to `path` registers as a change.
    flushSync(() => model.focusPath(bouncePath));
    flushSync(() => model.focusPath(path));
    return;
  }
  model.focusPath(path);
}

function expandAncestorFolders(model: FileTree, path: string): void {
  for (const ancestor of getAncestorFolderPaths(path)) {
    const item = model.getItem(ancestor);
    if (item && item.isDirectory()) item.expand();
  }
}

// Reveal `path` once its tree container actually has a size. A file opened from the
// chat, a hidden background tab (display:none), or a collapsed panel leaves the
// container zero-sized when the reveal is requested, and pierre no-ops a scroll until
// its virtualized viewport has a real box. A ResizeObserver fires the moment the box
// appears (same idiom as useXterm's cold-mount fit), then one settle frame lets pierre
// re-measure before scrolling (a scroll issued on the same frame the size changes
// no-ops). Returns a cleanup that stops a still-pending reveal.
function revealWhenSized(model: FileTree, path: string, bouncePath: string | null): () => void {
  expandAncestorFolders(model, path);
  let rafId = 0;
  let observer: ResizeObserver | null = null;
  const container = model.getFileTreeContainer();
  const rect = container?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) {
    rafId = window.requestAnimationFrame(() => focusPathWithTreeOwnership(model, path, bouncePath));
  } else if (container) {
    observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        observer?.disconnect();
        observer = null;
        rafId = window.requestAnimationFrame(() =>
          focusPathWithTreeOwnership(model, path, bouncePath),
        );
      }
    });
    observer.observe(container);
  }
  return () => {
    window.cancelAnimationFrame(rafId);
    observer?.disconnect();
  };
}

export interface TreeHandle {
  // Expand the path's ancestor folders and scroll it into view once the tree can
  // actually scroll (see revealWhenSized). The single canonical reveal used
  // by every caller so the layout race is handled in exactly one place.
  reveal: (path: string) => void;
}

export interface TreeProps {
  files: FileStructure[];
  selectedFile: FileStructure | null;
  onFileSelect: (file: FileStructure) => void;
  isSandboxSyncing?: boolean;
  modifiedPaths?: Set<string>;
  header?: ReactNode;
  ref?: Ref<TreeHandle>;
}

export const Tree = memo(function Tree({
  files,
  selectedFile,
  onFileSelect,
  isSandboxSyncing = false,
  modifiedPaths,
  header,
  ref,
}: TreeProps) {
  // Snapshot the latest files/handlers so the pierre callbacks can look up the
  // current FileStructure without recreating the model on every render.
  const filesRef = useRef(files);
  filesRef.current = files;
  const onFileSelectRef = useRef(onFileSelect);
  onFileSelectRef.current = onFileSelect;

  const paths = useMemo(
    () => traverseFileStructure(files, (item) => (item.type === 'file' ? item.path : null)),
    [files],
  );
  const pathSet = useMemo(() => new Set(paths), [paths]);
  const selectedPath = selectedFile?.path ?? null;
  // Retry selection/reveal when the tree model catches up to a newly-known path.
  const selectedPathIsKnown = selectedPath ? pathSet.has(selectedPath) : false;
  const initialPathsRef = useRef(paths);

  const { model } = useFileTree({
    paths: initialPathsRef.current,
    initialExpansion: 'closed',
    // Seeding also seeds focus, which makes cold-mount reveal a same-path no-op.
    initialSelectedPaths: [],
    search: true,
    icons: 'complete',
    itemHeight: 26,
    unsafeCSS: UNSAFE_CSS,
    onSelectionChange: (selectedPaths) => {
      const path = selectedPaths[0];
      if (!path) return;
      // Folder clicks arrive here too — only surface file selections upstream.
      const item = model.getItem(path);
      if (!item || item.isDirectory()) return;
      const file = findFileInStructure(filesRef.current, path);
      if (file) onFileSelectRef.current(file);
    },
  });

  useEffect(() => {
    // useFileTree already consumed the initial paths; skip re-applying on mount.
    if (paths === initialPathsRef.current) return;
    // resetPaths rebuilds the whole store from initialExpansion:'closed', so carry the
    // currently-open folders across — otherwise any files refetch collapses the tree
    // and drops the revealed selection.
    const expanded = new Set<string>();
    for (const path of paths) {
      for (const ancestor of getAncestorFolderPaths(path)) {
        if (!expanded.has(ancestor) && model.getItem(ancestor)?.isExpanded()) {
          expanded.add(ancestor);
        }
      }
    }
    model.resetPaths(paths, { initialExpandedPaths: [...expanded] });
  }, [paths, model]);

  useEffect(() => {
    const entries = modifiedPaths
      ? Array.from(modifiedPaths, (path) => ({ path, status: 'modified' as const }))
      : [];
    model.setGitStatus(entries);
  }, [modifiedPaths, model]);

  // Sync pierre's selection with selectedFile (set by external sources like CommandMenu).
  useEffect(() => {
    const currentPaths = model.getSelectedPaths();
    const next = selectedPath;
    const inSync = next
      ? currentPaths.length === 1 && currentPaths[0] === next
      : currentPaths.length === 0;
    if (inSync) return;
    // pierre-trees' public `select()` appends to the existing selection rather than replacing
    // (it routes to `selectPath`, not `selectOnlyPath`). Drop any stale entries first so
    // the resulting selection is a single item — otherwise onSelectionChange fires with
    // [oldPath, newPath] and our `selectedPaths[0]` reads the OLD path back into selectedFile.
    for (const path of currentPaths) {
      if (path !== next) model.getItem(path)?.deselect();
    }
    if (next && !currentPaths.includes(next)) {
      model.getItem(next)?.select();
    }
  }, [selectedPath, model, selectedPathIsKnown]);

  // The single reveal path for every caller (selection changes + imperative reveal).
  // One in-flight reveal's cleanup lives in a ref so a new reveal always cancels the
  // one still waiting on the previous path — otherwise two concurrent reveals (e.g. a
  // stale onExpand reveal racing a fresh selection) fight over the scroll position.
  const revealCleanupRef = useRef<(() => void) | null>(null);
  const startReveal = useCallback(
    (path: string) => {
      revealCleanupRef.current?.();
      // Bounce target for the already-focused case: the just-expanded parent folder,
      // or any other root entry when the file sits at the root (roots are always visible).
      const ancestors = getAncestorFolderPaths(path);
      const bouncePath =
        ancestors[ancestors.length - 1] ??
        filesRef.current.find((entry) => entry.path !== path)?.path ??
        null;
      revealCleanupRef.current = revealWhenSized(model, path, bouncePath);
    },
    [model],
  );

  useEffect(() => {
    if (selectedPath) startReveal(selectedPath);
  }, [selectedPath, startReveal, selectedPathIsKnown]);

  // Stop a reveal still waiting on a ResizeObserver when the tree unmounts (tab close
  // / navigation) so it can't touch a torn-down pierre model.
  useMountEffect(() => () => revealCleanupRef.current?.());

  useImperativeHandle(
    ref,
    () => ({
      reveal: (path: string) => startReveal(path),
    }),
    [startReveal],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== 'f') return;
      const active = document.activeElement;
      const isInInput =
        active?.tagName === 'INPUT' ||
        active?.tagName === 'TEXTAREA' ||
        (active as HTMLElement | null)?.contentEditable === 'true';
      if (isInInput) return;
      // offsetParent null when the tree lives in a hidden tab — yield the shortcut to siblings.
      const container = model.getFileTreeContainer();
      if (!container?.offsetParent) return;
      event.preventDefault();
      model.openSearch();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [model]);

  if (!hasActualFiles(files)) {
    return (
      <div className="flex h-full select-none flex-col items-center justify-center gap-2 px-4 py-12">
        {isSandboxSyncing ? (
          <Spinner size="md" className="text-text-quaternary dark:text-text-dark-quaternary" />
        ) : (
          <FolderOpen className="h-5 w-5 text-text-quaternary dark:text-text-dark-quaternary" />
        )}
        <p className="text-xs text-text-quaternary dark:text-text-dark-quaternary">
          {isSandboxSyncing ? 'Loading files...' : 'No files yet'}
        </p>
      </div>
    );
  }

  return <PierreFileTree model={model} header={header} className="h-full select-none" />;
});
