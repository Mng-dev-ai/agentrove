import { useState, useRef, useCallback, useEffect } from 'react';
import type { FileStructure } from '@/types/file-system.types';

interface UseEditorDraftsArgs {
  selectedFile: FileStructure | null;
  selectedFileContent: string | undefined;
  sandboxId: string | undefined;
  onCloseFile: (path: string) => void;
}

// Session-scoped unsaved buffers (not persisted). Tab switches keep drafts; sandbox/chat switch drops them.
export function useEditorDrafts({
  selectedFile,
  selectedFileContent,
  sandboxId,
  onCloseFile,
}: UseEditorDraftsArgs) {
  const [currentContent, setCurrentContent] = useState('');
  // Active file + saved baseline the live buffer diffs against.
  const prevSelectedFileRef = useRef<FileStructure | null>(null);
  const draftsRef = useRef<Map<string, string>>(new Map());
  // Mirrored in state so every tab can show its own unsaved dot.
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(() => new Set());
  const [pendingClosePath, setPendingClosePath] = useState<string | null>(null);
  const prevSandboxIdRef = useRef(sandboxId);
  const selectedFilePath = selectedFile?.path ?? null;

  if (prevSandboxIdRef.current !== sandboxId) {
    // Pane isn't remounted across chats; drafts are path-keyed only — drop them so
    // same-path files don't bleed across sandboxes. Null prev so content effect re-inits.
    prevSandboxIdRef.current = sandboxId;
    draftsRef.current.clear();
    prevSelectedFileRef.current = null;
    if (dirtyPaths.size > 0) setDirtyPaths(new Set());
    if (pendingClosePath !== null) setPendingClosePath(null);
  }

  const hasUnsavedChanges = !!selectedFilePath && dirtyPaths.has(selectedFilePath);
  const hasLoadedSelectedFile = prevSelectedFileRef.current?.path === selectedFile?.path;

  // Single writer keeps draftsRef and dirtyPaths in lockstep; null clears the draft.
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
      // Drop baseline so reopening the same path reloads from the server, not stale buffer.
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
      // User draft wins over refetch; only read once content loaded (avoid racing the fetch).
      const draft =
        selectedFileContent !== undefined ? draftsRef.current.get(selectedFile.path) : undefined;
      // Agent made the same edit — draft matches baseline, no longer dirty.
      if (draft !== undefined && draft === baseline) {
        setDraft(selectedFile.path, null);
      }

      prevSelectedFileRef.current = {
        ...selectedFile,
        content: baseline,
      };

      setCurrentContent(draft ?? baseline);
    }
  }, [selectedFile, selectedFileContent, setDraft]);

  // Selection updates before the content effect; hide previous file's text for that render.
  const displayContent = hasLoadedSelectedFile ? currentContent : (selectedFileContent ?? '');

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) return;

      setCurrentContent(value);

      const baseline = prevSelectedFileRef.current?.content ?? '';
      const path = prevSelectedFileRef.current?.path;
      if (path) setDraft(path, value !== baseline ? value : null);
    },
    [setDraft],
  );

  // Dirty close prompts first — draft is session-only and would be discarded silently.
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

  // Rebaseline the saved path (not the now-active tab) so further edits diff against disk.
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
