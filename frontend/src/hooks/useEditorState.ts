import { useState, useCallback, useMemo } from 'react';
import { useUIStore } from '@/store/uiStore';
import { findFileByToolPath } from '@/utils/file';
import type { FileStructure } from '@/types/file-system.types';
import type { EditorPaneState } from '@/types/ui.types';

const EMPTY_PATHS: string[] = [];

// Sentinel key for the chat-less landing editor, so its selection/tabs ride the
// same store map as real chats (cleared on landing mount — see LandingPage).
const LANDING_KEY = '__landing_editor__';

// Append a path to the open-tab list, preserving order and de-duping.
function openPath(open: string[], path: string): string[] {
  return open.includes(path) ? open : [...open, path];
}

// Remove a tab. When the active tab closes, selection falls back to its right
// neighbor, then its left, then nothing; otherwise selection is unchanged.
function closeTab(open: string[], closed: string, selected: string | null): EditorPaneState {
  const idx = open.indexOf(closed);
  const next = open.filter((p) => p !== closed);
  const nextSelected = selected !== closed ? selected : (next[idx] ?? next[idx - 1] ?? null);
  return { open: next, selected: nextSelected };
}

export function useEditorState(
  refetchFilesMetadata: () => Promise<unknown>,
  chatId: string | undefined,
  fileStructure: FileStructure[],
) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Both the chat editor and the landing editor stash their selection/tabs in the
  // store keyed by chat id (or LANDING_KEY) — selection survives EditorPane unmount,
  // and switching chatId reads a different entry so files can't bleed across chats.
  const key = chatId ?? LANDING_KEY;
  const entry = useUIStore((s) => s.editorByChat[key]);
  const selectedFilePath = entry?.selected ?? null;
  const openFilePaths = entry?.open ?? EMPTY_PATHS;

  // Resolve a stored path to a tree file, falling back to a stub so a file opened
  // before the tree loads (e.g. a tool's "open in editor") still renders.
  const resolveFile = useCallback(
    (path: string): FileStructure =>
      findFileByToolPath(fileStructure, path) ?? { path, type: 'file', content: '' },
    [fileStructure],
  );

  // Derived from the stashed path + fileStructure (no re-seed effect needed): the
  // derivation recomputes when the tree loads, and usePendingFileOpen writes the
  // path directly via setSelectedFile.
  const selectedFile = useMemo(() => {
    if (!selectedFilePath || fileStructure.length === 0) return null;
    return resolveFile(selectedFilePath);
  }, [selectedFilePath, fileStructure, resolveFile]);

  // The open tabs, resolved in stored order. Empty until the tree loads. Tabs only
  // track which files are open; View holds the active buffer and preserves per-file
  // unsaved drafts across tab switches/closes within the session.
  const openFiles = useMemo(() => {
    if (fileStructure.length === 0) return [];
    return openFilePaths.map(resolveFile);
  }, [openFilePaths, fileStructure, resolveFile]);

  const setSelectedFile = useCallback(
    (file: FileStructure | null) => {
      useUIStore.setState((s) => {
        if (!file) {
          // Deselect drops the whole entry — active file and tabs (landing's reset/switch).
          // No-op when the key was never present (the common case for the mount reset).
          if (!(key in s.editorByChat)) return {};
          const next = { ...s.editorByChat };
          delete next[key];
          return { editorByChat: next };
        }
        const cur = s.editorByChat[key] ?? { open: [], selected: null };
        return {
          editorByChat: {
            ...s.editorByChat,
            [key]: { open: openPath(cur.open, file.path), selected: file.path },
          },
        };
      });
    },
    [key],
  );

  // Closing a tab drops it and, if it was active, re-aims selection at a neighbor.
  // (A dirty tab is confirmed in View before this runs, and its draft discarded there.)
  const closeFile = useCallback(
    (path: string) => {
      useUIStore.setState((s) => {
        const cur = s.editorByChat[key];
        if (!cur || !cur.open.includes(path)) return {};
        // Selection and tabs update atomically — no chance of the two drifting apart.
        return {
          editorByChat: { ...s.editorByChat, [key]: closeTab(cur.open, path, cur.selected) },
        };
      });
    },
    [key],
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refetchFilesMetadata();
    } finally {
      setIsRefreshing(false);
    }
  }, [refetchFilesMetadata]);

  return {
    selectedFile,
    setSelectedFile,
    openFiles,
    closeFile,
    isRefreshing,
    handleRefresh,
  };
}
