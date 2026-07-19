import { useState, useCallback, useMemo } from 'react';
import { useUIStore } from '@/store/uiStore';
import { findFileByToolPath } from '@/utils/file';
import type { FileStructure } from '@/types/file-system.types';
import type { EditorPaneState } from '@/types/ui.types';

const EMPTY_PATHS: string[] = [];

// Sentinel key for the chat-less landing editor, so its selection/tabs ride the
// same store map as real chats (cleared on landing mount — see LandingPage).
const LANDING_KEY = '__landing_editor__';

function openPath(open: string[], path: string): string[] {
  return open.includes(path) ? open : [...open, path];
}

// Active tab close → right neighbor, else left, else null.
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
  // Store-keyed selection survives EditorPane unmount; per-chat keys prevent bleed.
  const key = chatId ?? LANDING_KEY;
  const entry = useUIStore((s) => s.editorByChat[key]);
  const selectedFilePath = entry?.selected ?? null;
  const openFilePaths = entry?.open ?? EMPTY_PATHS;

  // Stub fallback so "open in editor" before the tree loads still renders.
  const resolveFile = useCallback(
    (path: string): FileStructure =>
      findFileByToolPath(fileStructure, path) ?? { path, type: 'file', content: '' },
    [fileStructure],
  );

  // Not gated on tree load — stub lets file-content fetch run in parallel with metadata.
  const selectedFile = useMemo(() => {
    if (!selectedFilePath) return null;
    return resolveFile(selectedFilePath);
  }, [selectedFilePath, resolveFile]);

  const openFiles = useMemo(() => openFilePaths.map(resolveFile), [openFilePaths, resolveFile]);

  const setSelectedFile = useCallback(
    (file: FileStructure | null) => {
      useUIStore.setState((s) => {
        if (!file) {
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

  const closeFile = useCallback(
    (path: string) => {
      useUIStore.setState((s) => {
        const cur = s.editorByChat[key];
        if (!cur || !cur.open.includes(path)) return {};
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
