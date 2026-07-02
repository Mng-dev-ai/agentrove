import { useState, useRef, useCallback, useEffect } from 'react';
import type { FileStructure } from '@/types/file-system.types';

interface UseEditorDraftsArgs {
  selectedFile: FileStructure | null;
  // Loaded server content for the active file, or undefined until it resolves.
  selectedFileContent: string | undefined;
  sandboxId: string | undefined;
  onCloseFile: (path: string) => void;
}

// Owns the editor's per-file unsaved buffers: the live content of the active file,
// a draft per open path, the dirty set that drives the tab dots, and the close
// confirmation flow. Drafts are session-scoped to one sandbox (see the reset) and are
// NOT persisted — switching tabs preserves them, but a chat/sandbox switch drops them.
export function useEditorDrafts({
  selectedFile,
  selectedFileContent,
  sandboxId,
  onCloseFile,
}: UseEditorDraftsArgs) {
  const [currentContent, setCurrentContent] = useState('');
  // path + baseline for the active file; the baseline is the saved content the
  // live buffer diffs against.
  const prevSelectedFileRef = useRef<FileStructure | null>(null);
  // Per-file unsaved buffers (path -> content).
  const draftsRef = useRef<Map<string, string>>(new Map());
  // The paths of those dirty buffers, mirrored in state so each tab renders its own
  // unsaved dot (any open tab can be dirty, not just the active one).
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(() => new Set());
  // The dirty tab awaiting a discard confirmation before it closes (null = no prompt).
  const [pendingClosePath, setPendingClosePath] = useState<string | null>(null);
  const prevSandboxIdRef = useRef(sandboxId);
  const selectedFilePath = selectedFile?.path ?? null;

  if (prevSandboxIdRef.current !== sandboxId) {
    // The editor pane is reused across chats/sandboxes without remounting (the split
    // and landing editors aren't keyed by chat), and drafts are keyed by path only —
    // so drop the previous sandbox's buffers to avoid bleeding edits into another
    // sandbox's same-path file. Null prevSelectedFileRef so the content effect re-inits.
    prevSandboxIdRef.current = sandboxId;
    draftsRef.current.clear();
    prevSelectedFileRef.current = null;
    if (dirtyPaths.size > 0) setDirtyPaths(new Set());
    if (pendingClosePath !== null) setPendingClosePath(null);
  }

  // Active file's dirty flag, derived from the per-file dirty set (single source of truth).
  const hasUnsavedChanges = !!selectedFilePath && dirtyPaths.has(selectedFilePath);
  const hasLoadedSelectedFile = prevSelectedFileRef.current?.path === selectedFile?.path;

  // Single writer for a file's draft buffer — keeps draftsRef and the dirtyPaths render
  // mirror in lockstep so no call site has to update both. `null` content clears the
  // draft (and drives the per-tab unsaved dot off).
  const setDraft = useCallback((path: string, content: string | null) => {
    const isDirty = content !== null;
    if (isDirty) draftsRef.current.set(path, content);
    else draftsRef.current.delete(path);
    setDirtyPaths((prev) => {
      if (prev.has(path) === isDirty) return prev;
      const next = new Set(prev);
      if (isDirty) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      // No active file (e.g. the last tab was closed/discarded): drop the stale buffer and
      // baseline so reopening the same path reloads from the server instead of resurrecting
      // the old content as if it were clean.
      prevSelectedFileRef.current = null;
      setCurrentContent('');
      return;
    }

    const prev = prevSelectedFileRef.current;
    const fileChanged = !prev || prev.path !== selectedFile.path;

    const queryContentChanged =
      selectedFileContent !== undefined &&
      prev?.path === selectedFile.path &&
      prev?.content !== selectedFileContent;

    if (fileChanged || queryContentChanged) {
      const baseline = selectedFileContent ?? '';
      // Restore an unsaved draft once content has loaded — covers a tab switch, a
      // deferred load, and an external update (agent edited the file mid-draft):
      // the user's unsaved buffer always wins over refetched content, rebased on
      // the new baseline so the dirty diff tracks the current server state.
      // Guarded on loaded content to not race the async fetch.
      const draft =
        selectedFileContent !== undefined ? draftsRef.current.get(selectedFile.path) : undefined;
      // The refetch may return exactly what the draft already says (the agent
      // made the same edit) — the buffer is no longer dirty then.
      if (draft !== undefined && draft === baseline) {
        setDraft(selectedFile.path, null);
      }

      prevSelectedFileRef.current = {
        ...selectedFile,
        content: baseline,
      };

      // dirtyPaths already reflects this file's draft (kept in sync by handleEditorChange),
      // so the derived hasUnsavedChanges is correct without a separate write here.
      setCurrentContent(draft ?? baseline);
    }
  }, [selectedFile, selectedFileContent, setDraft]);

  // File selection updates before the content effect resets state; keep the previous
  // file's text out of Monaco during that one render.
  const displayContent = hasLoadedSelectedFile ? currentContent : (selectedFileContent ?? '');

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) return;

      setCurrentContent(value);

      const baseline = prevSelectedFileRef.current?.content ?? '';
      const path = prevSelectedFileRef.current?.path;
      // Persist the draft (or clear it once it matches the saved baseline) so the buffer
      // survives a tab switch and the tab's unsaved dot stays accurate.
      if (path) setDraft(path, value !== baseline ? value : null);
    },
    [setDraft],
  );

  // Closing a clean tab is immediate; closing a dirty one prompts first, since its
  // draft lives only in this session and would be discarded with no further warning.
  const handleCloseTab = useCallback(
    (path: string) => {
      if (dirtyPaths.has(path)) setPendingClosePath(path);
      else onCloseFile(path);
    },
    [dirtyPaths, onCloseFile],
  );

  const confirmCloseTab = useCallback(() => {
    if (pendingClosePath === null) return;
    setDraft(pendingClosePath, null);
    onCloseFile(pendingClosePath);
    setPendingClosePath(null);
  }, [pendingClosePath, setDraft, onCloseFile]);

  const cancelCloseTab = useCallback(() => setPendingClosePath(null), []);

  // After a save succeeds: rebaseline the saved file (if still active) so further edits
  // diff against disk, and clear its draft. Scoped to the saved path captured at submit
  // time, not the now-active tab.
  const commitSave = useCallback(
    (savedPath: string, submitted: string) => {
      if (prevSelectedFileRef.current?.path === savedPath) {
        prevSelectedFileRef.current = {
          ...prevSelectedFileRef.current,
          content: submitted,
        };
      }
      setDraft(savedPath, null);
    },
    [setDraft],
  );

  return {
    currentContent,
    displayContent,
    hasUnsavedChanges,
    hasLoadedSelectedFile,
    dirtyPaths,
    pendingClosePath,
    handleEditorChange,
    handleCloseTab,
    confirmCloseTab,
    cancelCloseTab,
    commitSave,
  };
}
