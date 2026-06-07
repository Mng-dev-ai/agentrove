import { useEffect } from 'react';
import { useUIStore } from '@/store/uiStore';
import { findFileByToolPath } from '@/utils/file';
import type { FileStructure } from '@/types/file-system.types';

export function usePendingFileOpen(
  fileStructure: FileStructure[],
  setSelectedFile: (file: FileStructure | null) => void,
  chatId: string | undefined,
) {
  const pendingFilePath = useUIStore((s) => s.pendingFilePath);

  useEffect(() => {
    // Ignore opens bound to the other chat's editor so each editor claims only
    // its own — the primary and secondary editors share this store field.
    if (!pendingFilePath || pendingFilePath.chatId !== chatId || fileStructure.length === 0) return;
    const path = pendingFilePath.path;
    const file = findFileByToolPath(fileStructure, path);
    setSelectedFile(file ?? { path, type: 'file', content: '' });
    useUIStore.setState({ pendingFilePath: null });
  }, [pendingFilePath, setSelectedFile, fileStructure, chatId]);
}
