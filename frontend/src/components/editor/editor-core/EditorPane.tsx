import { memo } from 'react';
import { Editor } from '@/components/editor/editor-core/Editor';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useSandboxFiles } from '@/hooks/useSandboxFiles';
import { useEditorState } from '@/hooks/useEditorState';
import { useFirstPaint } from '@/hooks/useFirstPaint';
import { viewLoadingFallback } from '@/components/ui/shared/ViewLoadingFallback/ViewLoadingFallback';

// Per-pane editor: owns its file data/selection so each split tracks its own chat.
export const EditorPane = memo(function EditorPane({ chatId }: { chatId: string | undefined }) {
  // Defer heavy mount past navigation paint (lazy chunk is already cached on chat switch).
  const hasPainted = useFirstPaint();

  const { data: currentChat } = useChatQuery(chatId);
  const { fileStructure, isFileMetadataLoading, refetchFilesMetadata } = useSandboxFiles(
    currentChat,
    chatId,
  );
  const { selectedFile, setSelectedFile, openFiles, closeFile, isRefreshing, handleRefresh } =
    useEditorState(refetchFilesMetadata, chatId, fileStructure);

  if (!hasPainted) return viewLoadingFallback;

  return (
    <Editor
      files={fileStructure}
      selectedFile={selectedFile}
      onFileSelect={setSelectedFile}
      openFiles={openFiles}
      onCloseFile={closeFile}
      sandboxId={currentChat?.sandbox_id ?? undefined}
      worktreeCwd={currentChat?.worktree_cwd ?? undefined}
      isSandboxSyncing={isFileMetadataLoading}
      onRefresh={handleRefresh}
      isRefreshing={isRefreshing}
      chatId={chatId}
    />
  );
});
