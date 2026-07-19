import { type RefObject } from 'react';
import type * as monaco from 'monaco-editor';
import type { FileStructure } from '@/types/file-system.types';
import type { EditorCodeSelection } from '@/store/uiStore';
import { Content } from './Content';
import { DiffContent } from './DiffContent';
import { InlineChatWidget } from './InlineChatWidget';
import { FilePreview } from '../file-preview/FilePreview';
import styles from './ViewContentArea.module.scss';

export interface ViewContentAreaProps {
  isLoadingContent: boolean;
  viewMode: 'code' | 'preview' | 'diff';
  inlineChat: { selection: EditorCodeSelection; nonce: number } | null;
  chatId: string | undefined;
  editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>;
  monacoRef: RefObject<typeof import('monaco-editor') | null>;
  onCloseInlineChat: () => void;
  selectedFile: FileStructure;
  sandboxId?: string;
  diffOriginal: string | undefined;
  isGitRepo: boolean;
  isLoadingBaseline: boolean;
  isBaselineError: boolean;
  fileChangedInGit: boolean;
  onRetryBaseline: () => void;
  displayContent: string;
  language: string;
  currentTheme: string;
  setupEditorTheme: (monaco: typeof import('monaco-editor')) => void;
  isReadOnly: boolean;
  onEditorChange: (value: string | undefined) => void;
  onEditorMount: (
    editor: monaco.editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor'),
  ) => void;
  isPreviewActive: boolean;
  fileForPreview: FileStructure | null;
  isPreviewFullscreen: boolean;
  onTogglePreviewFullscreen: () => void;
}

// Presentation of View modes (diff/code/preview/inline chat); View owns file/draft state.
export function ViewContentArea({
  isLoadingContent,
  viewMode,
  inlineChat,
  chatId,
  editorRef,
  monacoRef,
  onCloseInlineChat,
  selectedFile,
  sandboxId,
  diffOriginal,
  isGitRepo,
  isLoadingBaseline,
  isBaselineError,
  fileChangedInGit,
  onRetryBaseline,
  displayContent,
  language,
  currentTheme,
  setupEditorTheme,
  isReadOnly,
  onEditorChange,
  onEditorMount,
  isPreviewActive,
  fileForPreview,
  isPreviewFullscreen,
  onTogglePreviewFullscreen,
}: ViewContentAreaProps) {
  return (
    <div className={styles['content-area']}>
      {isLoadingContent && (
        <div className={styles['loading-overlay']}>
          <div className={styles['loading-text']}>Loading file content...</div>
        </div>
      )}

      {/* Listed before Content so its cleanup removes the content widget
          before @monaco-editor/react disposes the editor on unmount. */}
      {viewMode === 'code' && inlineChat && chatId && editorRef.current && monacoRef.current && (
        <InlineChatWidget
          key={inlineChat.nonce}
          monaco={monacoRef.current}
          editor={editorRef.current}
          chatId={chatId}
          selection={inlineChat.selection}
          onClose={onCloseInlineChat}
        />
      )}

      {viewMode === 'diff' && (
        <DiffContent
          key={selectedFile.path}
          original={diffOriginal}
          modified={displayContent}
          language={language}
          theme={currentTheme}
          isLoading={isLoadingBaseline}
          isError={isBaselineError}
          isGitRepo={isGitRepo}
          hasGitChanges={fileChangedInGit}
          onRetry={onRetryBaseline}
          onBeforeMount={setupEditorTheme}
        />
      )}

      {viewMode !== 'diff' && !isPreviewActive && (
        <Content
          key={selectedFile.path}
          content={displayContent}
          language={language}
          // The sandbox rides in the URI authority so uri.path stays the clean
          // workspace path — peek widgets label results straight from uri.path.
          modelPath={`sandbox://${sandboxId ?? 'workspace'}/${selectedFile.path}`}
          // Lock edits while a save is in flight so the in-flight buffer can't
          // diverge from what was submitted — the success handler then clears the
          // draft unconditionally without risking newer keystrokes.
          isReadOnly={isReadOnly}
          onChange={onEditorChange}
          onMount={onEditorMount}
          theme={currentTheme}
        />
      )}

      {isPreviewActive && fileForPreview && (
        <div className={styles['preview-wrapper']}>
          <FilePreview
            file={fileForPreview}
            isFullscreen={isPreviewFullscreen}
            onToggleFullscreen={onTogglePreviewFullscreen}
          />
        </div>
      )}
    </div>
  );
}
