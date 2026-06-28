import { useState, useCallback, useMemo } from 'react';
import { useUIStore } from '@/store/uiStore';
import { findFileByToolPath } from '@/utils/file';
import type { FileStructure } from '@/types/file-system.types';

export function useEditorState(
  refetchFilesMetadata: () => Promise<unknown>,
  chatId: string | undefined,
  fileStructure: FileStructure[],
) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Landing page (no chat) uses local state — nothing to persist across chat
  // switches since there's no chat to switch back to.
  const [localSelectedFile, setLocalSelectedFile] = useState<FileStructure | null>(null);
  const selectedFilePath = useUIStore((s) => (chatId ? s.selectedFileByChat[chatId] : undefined));

  // Store-backed when chatId is set (persists across chat switches); local
  // state for the chat-less landing page. Derived from the stashed path +
  // fileStructure so the selection survives EditorPane unmount — switching
  // chatId reads a different store entry, so the old chat's file can't bleed
  // through. No re-seed effect needed: the derivation recomputes when the tree
  // loads, and usePendingFileOpen writes the path directly via setSelectedFile.
  const selectedFile = useMemo(() => {
    if (!chatId) return localSelectedFile;
    if (!selectedFilePath || fileStructure.length === 0) return null;
    return (
      findFileByToolPath(fileStructure, selectedFilePath) ?? {
        path: selectedFilePath,
        type: 'file',
        content: '',
      }
    );
  }, [chatId, localSelectedFile, selectedFilePath, fileStructure]);

  const setSelectedFile = useCallback(
    (file: FileStructure | null) => {
      if (!chatId) {
        setLocalSelectedFile(file);
        return;
      }
      useUIStore.setState((s) => {
        if (!file) {
          const next = { ...s.selectedFileByChat };
          delete next[chatId];
          return { selectedFileByChat: next };
        }
        return { selectedFileByChat: { ...s.selectedFileByChat, [chatId]: file.path } };
      });
    },
    [chatId],
  );

  const handleFileSelect = useCallback(
    (file: FileStructure | null) => setSelectedFile(file),
    [setSelectedFile],
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
    handleFileSelect,
    isRefreshing,
    handleRefresh,
  };
}
