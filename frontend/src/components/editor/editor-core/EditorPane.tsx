import { memo } from 'react';
import { Editor } from '@/components/editor/editor-core/Editor';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useSandboxFiles } from '@/hooks/useSandboxFiles';
import { useEditorState } from '@/hooks/useEditorState';
import { useFirstPaint } from '@/hooks/useFirstPaint';
import { viewLoadingFallback } from '@/components/ui/shared/ViewLoadingFallback/ViewLoadingFallback';

// Self-contained editor for a chat, rendered once per pane in split view. It
// owns its file data and selection so each pane tracks its own chat (mirrors
// how AgentPane wraps the secondary chat).
export const EditorPane = memo(function EditorPane({ chatId }: { chatId: string | undefined }) {
  // Chat switches remount this pane with the lazy chunk already cached, so the
  // heavy editor subtree (pierre tree model, Monaco) would mount inside the
  // navigation's commit and block its first paint for seconds on large workspaces.
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
