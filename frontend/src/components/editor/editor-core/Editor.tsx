import { memo, useState, useCallback } from 'react';
import { logger } from '@/utils/logger';
import { CodeView } from '../code-view/CodeView';
import type { FileStructure } from '@/types/file-system.types';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import { sandboxService } from '@/services/sandboxService';
import styles from './Editor.module.scss';

export interface EditorProps {
  files: FileStructure[];
  selectedFile: FileStructure | null;
  onFileSelect: (file: FileStructure | null) => void;
  openFiles: FileStructure[];
  onCloseFile: (path: string) => void;
  sandboxId?: string;
  worktreeCwd?: string;
  isSandboxSyncing?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  // Required so every editor instance consciously declares which chat's pending
  // file opens/jumps it claims — `undefined` is the chat-less landing editor.
  chatId: string | undefined;
}

export const Editor = memo(function Editor({
  files,
  onFileSelect,
  selectedFile,
  openFiles,
  onCloseFile,
  sandboxId,
  worktreeCwd,
  isSandboxSyncing = false,
  onRefresh,
  isRefreshing = false,
  chatId,
}: EditorProps) {
  const theme = useResolvedTheme();
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    try {
      if (!sandboxId) {
        return;
      }

      setIsDownloading(true);

      const zipBlob = await sandboxService.downloadZip(sandboxId);

      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      const fileName = `sandbox_${sandboxId}_${crypto.randomUUID()}.zip`;
      link.download = fileName;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      logger.error('Sandbox download failed', 'Editor', error);
    } finally {
      setIsDownloading(false);
    }
  }, [sandboxId]);

  return (
    <div className={styles.editor}>
      <CodeView
        files={files}
        selectedFile={selectedFile}
        onFileSelect={onFileSelect}
        openFiles={openFiles}
        onCloseFile={onCloseFile}
        theme={theme}
        sandboxId={sandboxId}
        cwd={worktreeCwd}
        onDownload={handleDownload}
        isDownloading={isDownloading}
        isSandboxSyncing={isSandboxSyncing}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        chatId={chatId}
      />
    </div>
  );
});
