import { memo, useState, useRef, useCallback, useEffect } from 'react';
import type * as monaco from 'monaco-editor';
import { Header } from './Header';
import { Content } from './Content';
import { EmptyState } from './EmptyState';
import { EditorTabs } from './EditorTabs';
import { FilePreview } from '../file-preview/FilePreview';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useEditorTheme } from '@/hooks/useEditorTheme';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import { useEditorDrafts } from '@/hooks/useEditorDrafts';
import type { FileStructure } from '@/types/file-system.types';
import { detectLanguage, findFileInStructure, getFileName } from '@/utils/file';
import { useUpdateFileMutation, useFileContentQuery } from '@/hooks/queries/useSandboxQueries';
import { isPreviewableFile, isHtmlFile } from '@/utils/fileTypes';
import toast from 'react-hot-toast';

export interface ViewProps {
  selectedFile: FileStructure | null;
  fileStructure?: FileStructure[];
  sandboxId?: string;
  onToggleFileTree?: () => void;
  isFileTreeCollapsed?: boolean;
  targetLine?: { path: string; line: number; nonce: number } | null;
  openFiles: FileStructure[];
  onFileSelect: (file: FileStructure) => void;
  onCloseFile: (path: string) => void;
}

export const View = memo(function View({
  selectedFile,
  fileStructure = [],
  sandboxId,
  onToggleFileTree,
  isFileTreeCollapsed,
  targetLine,
  openFiles,
  onFileSelect,
  onCloseFile,
}: ViewProps) {
  const theme = useResolvedTheme();
  const [showPreview, setShowPreview] = useState(false);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const selectedFilePath = selectedFile?.path ?? null;
  const mountedEditorPathRef = useRef(selectedFilePath);
  const [mountedEditorPath, setMountedEditorPath] = useState<string | null>(null);

  if (mountedEditorPathRef.current !== selectedFilePath) {
    // Content remounts by path; clear stale Monaco refs before jump effects run.
    mountedEditorPathRef.current = selectedFilePath;
    editorRef.current = null;
    if (mountedEditorPath !== null) setMountedEditorPath(null);
  }

  const { currentTheme, setupEditorTheme } = useEditorTheme();
  const updateFileMutation = useUpdateFileMutation();

  const {
    data: fileContentData,
    isLoading: isLoadingContent,
    error: fileContentError,
  } = useFileContentQuery(sandboxId, selectedFile?.path, {
    enabled: !!sandboxId && !!selectedFile?.path,
    retry: 1,
  });

  const selectedFileContent =
    selectedFile && fileContentData?.path === selectedFile.path
      ? fileContentData.content
      : undefined;

  // Per-file unsaved drafts, the dirty set, and the close-confirm flow live in this hook.
  const {
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
  } = useEditorDrafts({ selectedFile, selectedFileContent, sandboxId, onCloseFile });

  const shouldShowSelectedFilePreview = selectedFile
    ? isPreviewableFile(selectedFile) && !isHtmlFile(selectedFile)
    : false;

  const error = fileContentError
    ? fileContentError instanceof Error
      ? fileContentError.message
      : 'Failed to load file content'
    : null;

  useEffect(() => {
    if (!selectedFilePath) {
      setShowPreview(false);
      return;
    }

    setShowPreview((current) =>
      current === shouldShowSelectedFilePreview ? current : shouldShowSelectedFilePreview,
    );
  }, [selectedFilePath, shouldShowSelectedFilePreview]);

  const language = selectedFile ? detectLanguage(selectedFile.path) : 'javascript';
  const displayHasUnsavedChanges = hasLoadedSelectedFile && hasUnsavedChanges;

  const handleUpdateFile = useCallback(async () => {
    if (!selectedFile || !sandboxId || !hasUnsavedChanges || !hasLoadedSelectedFile) return;

    // Capture what we're saving; the active tab/content may change before this resolves.
    const savedPath = selectedFile.path;
    const submitted = currentContent;

    updateFileMutation.mutate(
      {
        sandboxId,
        filePath: savedPath,
        content: submitted,
      },
      {
        onSuccess: () => {
          commitSave(savedPath, submitted);
          toast.success('File saved');
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : 'Failed to update file');
        },
      },
    );
  }, [
    selectedFile,
    sandboxId,
    currentContent,
    hasUnsavedChanges,
    hasLoadedSelectedFile,
    updateFileMutation,
    commitSave,
  ]);

  const handleEditorMount = useCallback(
    (editor: monaco.editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => {
      if (!selectedFilePath) return;

      editorRef.current = editor;
      setupEditorTheme(monaco);
      setMountedEditorPath(selectedFilePath);
    },
    [selectedFilePath, setupEditorTheme],
  );

  const lastAppliedTargetRef = useRef<string>('');

  useEffect(() => {
    // Reveal + select the requested line after Monaco's model has absorbed the
    // loaded content. @monaco-editor/react syncs `value` -> model inside its
    // own effect; rAF lets that flush before we reveal, otherwise the editor
    // would still hold the old model and the line would be clamped wrong.
    if (!targetLine || !selectedFile) return;
    if (selectedFile.path !== targetLine.path) return;
    if (selectedFileContent === undefined) return;
    if (mountedEditorPath !== selectedFile.path) return;
    const editor = editorRef.current;
    if (!editor) return;
    // Dedupe by the requested target, not the resolved/clamped line — after a
    // jump to line 100, editing the file down to fewer lines shouldn't re-fire
    // the same target and yank focus back to the clamped position.
    const key = `${targetLine.path}:${targetLine.line}:${targetLine.nonce}`;
    if (lastAppliedTargetRef.current === key) return;

    const raf = requestAnimationFrame(() => {
      if (editorRef.current !== editor) return;
      const model = editor.getModel();
      if (!model) return;
      let lineNumber = Math.max(1, targetLine.line);
      if (model.getLineCount() < lineNumber) {
        // The model is shorter than the requested line. If the loaded content
        // hasn't synced into Monaco's value prop yet, wait for the next run
        // (currentContent is in deps) instead of clamping a stale buffer.
        // Otherwise the file genuinely lacks the line — clamp to the last.
        // Compare against currentContent (not model.getValue()) to avoid
        // Monaco's EOL normalization breaking the readiness check.
        const contentReady = hasUnsavedChanges || currentContent === selectedFileContent;
        if (!contentReady) return;
        lineNumber = model.getLineCount();
      }
      lastAppliedTargetRef.current = key;
      editor.revealLineInCenter(lineNumber);
      editor.setPosition({ lineNumber, column: 1 });
      editor.setSelection({
        startLineNumber: lineNumber,
        startColumn: 1,
        endLineNumber: lineNumber,
        endColumn: Number.MAX_SAFE_INTEGER,
      });
      editor.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [
    targetLine,
    selectedFile,
    selectedFileContent,
    currentContent,
    hasUnsavedChanges,
    mountedEditorPath,
  ]);

  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const prevShowPreviewRef = useRef(showPreview);
  const prevFilePathRef = useRef(selectedFile?.path);

  // Reset fullscreen when preview is hidden or file changes
  if (
    prevShowPreviewRef.current !== showPreview ||
    prevFilePathRef.current !== selectedFile?.path
  ) {
    prevShowPreviewRef.current = showPreview;
    prevFilePathRef.current = selectedFile?.path;
    if (isPreviewFullscreen) {
      setIsPreviewFullscreen(false);
    }
  }

  const handleTogglePreviewFullscreen = useCallback(() => {
    setIsPreviewFullscreen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!isPreviewFullscreen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsPreviewFullscreen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isPreviewFullscreen]);

  const isValidFile =
    selectedFile && findFileInStructure(fileStructure, selectedFile.path) !== undefined;

  const isPreviewable = selectedFile ? isPreviewableFile(selectedFile) : false;

  const handlePreviewToggle = (showPreviewState: boolean) => {
    setShowPreview(showPreviewState);
  };

  const fileForPreview = selectedFile
    ? {
        ...selectedFile,
        content: displayContent,
      }
    : null;

  // Tabs stay mounted above the content even when the active file is invalid
  // (e.g. deleted from the tree), so the user can still switch to a sibling tab.
  return (
    <div className="relative flex h-full flex-col">
      <EditorTabs
        openFiles={openFiles}
        selectedPath={selectedFile?.path ?? null}
        dirtyPaths={dirtyPaths}
        onSelect={onFileSelect}
        onClose={handleCloseTab}
      />

      {!selectedFile || !isValidFile ? (
        <EmptyState theme={theme} onToggleFileTree={onToggleFileTree} />
      ) : (
        <>
          <Header
            filePath={selectedFile.path}
            error={error}
            selectedFile={selectedFile}
            showPreview={showPreview}
            onTogglePreview={handlePreviewToggle}
            hasUnsavedChanges={displayHasUnsavedChanges}
            isSaving={updateFileMutation.isPending}
            onSave={handleUpdateFile}
            onToggleFileTree={onToggleFileTree}
            isFileTreeCollapsed={isFileTreeCollapsed}
            onToggleFullscreen={
              isPreviewable && showPreview ? handleTogglePreviewFullscreen : undefined
            }
          />

          <div className="relative flex-1 overflow-hidden">
            {isLoadingContent && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-secondary bg-opacity-75 dark:bg-surface-dark-secondary">
                <div className="text-sm text-text-secondary dark:text-text-dark-secondary">
                  Loading file content...
                </div>
              </div>
            )}

            {!(isPreviewable && showPreview) && (
              <Content
                key={selectedFile.path}
                content={displayContent}
                language={language}
                modelPath={`/${sandboxId ?? 'workspace'}/${selectedFile.path}`}
                // Lock edits while a save is in flight so the in-flight buffer can't
                // diverge from what was submitted — the success handler then clears the
                // draft unconditionally without risking newer keystrokes.
                isReadOnly={updateFileMutation.isPending}
                onChange={handleEditorChange}
                onMount={handleEditorMount}
                theme={currentTheme}
              />
            )}

            {isPreviewable && showPreview && fileForPreview && (
              <div className="h-full">
                <FilePreview
                  file={fileForPreview}
                  isFullscreen={isPreviewFullscreen}
                  onToggleFullscreen={handleTogglePreviewFullscreen}
                />
              </div>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        isOpen={pendingClosePath !== null}
        onClose={cancelCloseTab}
        onConfirm={confirmCloseTab}
        title="Discard unsaved changes?"
        message={`"${getFileName(pendingClosePath ?? '')}" has unsaved edits that will be lost.`}
        confirmLabel="Discard"
        cancelLabel="Cancel"
      />
    </div>
  );
});
