import { memo, useState, useRef, useCallback, useEffect } from 'react';
import type * as monaco from 'monaco-editor';
import { Header } from './Header';
import { Content } from './Content';
import { DiffContent } from './DiffContent';
import { EmptyState } from './EmptyState';
import { EditorTabs } from './EditorTabs';
import { FilePreview } from '../file-preview/FilePreview';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useEditorTheme } from '@/hooks/useEditorTheme';
import { attachEditorNavigationContext, setupEditorNavigation } from '@/lib/editorNavigation';
import type { EditorNavigationContext } from '@/lib/editorNavigation';
import { attachAddSelectionToChat, attachAskAboutSelection } from '@/lib/editorChatActions';
import { InlineChatWidget } from './InlineChatWidget';
import type { EditorCodeSelection } from '@/store/uiStore';
import { useResolvedTheme } from '@/hooks/useResolvedTheme';
import { useEditorDrafts } from '@/hooks/useEditorDrafts';
import type { FileStructure } from '@/types/file-system.types';
import { detectLanguage, findFileInStructure, getFileName } from '@/utils/file';
import {
  useUpdateFileMutation,
  useFileContentQuery,
  useGitChangedPathsQuery,
  useGitFileBaselineQuery,
} from '@/hooks/queries/useSandboxQueries';
import { isPreviewableFile, isHtmlFile } from '@/utils/fileTypes';
import toast from 'react-hot-toast';

// The content area's mutually-exclusive modes — a single union so an illegal
// combination (e.g. preview+diff) can't be represented.
type ViewMode = 'code' | 'preview' | 'diff';

// Previewable types open in preview; HTML opens raw (its preview is opt-in
// via the toggle).
function defaultViewMode(file: FileStructure | null): ViewMode {
  return file && isPreviewableFile(file) && !isHtmlFile(file) ? 'preview' : 'code';
}

export interface ViewProps {
  selectedFile: FileStructure | null;
  fileStructure?: FileStructure[];
  sandboxId?: string;
  chatId: string | undefined;
  cwd?: string;
  onToggleFileTree?: () => void;
  isFileTreeCollapsed?: boolean;
  isSandboxSyncing?: boolean;
  targetLine?: { path: string; line: number; nonce: number } | null;
  openFiles: FileStructure[];
  onFileSelect: (file: FileStructure) => void;
  onCloseFile: (path: string) => void;
}

export const View = memo(function View({
  selectedFile,
  fileStructure = [],
  sandboxId,
  chatId,
  cwd,
  onToggleFileTree,
  isFileTreeCollapsed,
  isSandboxSyncing = false,
  targetLine,
  openFiles,
  onFileSelect,
  onCloseFile,
}: ViewProps) {
  const theme = useResolvedTheme();
  const [viewMode, setViewMode] = useState<ViewMode>(() => defaultViewMode(selectedFile));
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const selectedFilePath = selectedFile?.path ?? null;
  const mountedEditorPathRef = useRef(selectedFilePath);
  const [mountedEditorPath, setMountedEditorPath] = useState<string | null>(null);
  const [inlineChat, setInlineChat] = useState<{
    selection: EditorCodeSelection;
    nonce: number;
  } | null>(null);

  // Nonce remounts the widget on every trigger — line ranges alone can't tell
  // a new selection from the last one (same lines, different text/columns).
  const openInlineChat = useCallback((selection: EditorCodeSelection) => {
    setInlineChat((prev) => ({ selection, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  if (mountedEditorPathRef.current !== selectedFilePath) {
    // Content remounts by path; clear stale Monaco refs before jump effects run.
    mountedEditorPathRef.current = selectedFilePath;
    editorRef.current = null;
    if (mountedEditorPath !== null) setMountedEditorPath(null);
  }

  // Mutated in place each render: the navigation claim holds this same object,
  // so chat/cwd prop changes apply to an already-mounted editor without remount.
  const navigationContext = useRef<EditorNavigationContext>({ sandboxId, chatId, cwd });
  navigationContext.current.sandboxId = sandboxId;
  navigationContext.current.chatId = chatId;
  navigationContext.current.cwd = cwd;

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

  // Git paths are cwd-relative while editor paths are workspace-root-relative
  // (see invalidateAfterGitRestore) — strip the cwd prefix before asking git.
  const gitRelativePath =
    selectedFilePath && cwd && selectedFilePath.startsWith(`${cwd}/`)
      ? selectedFilePath.slice(cwd.length + 1)
      : selectedFilePath;

  const {
    data: baselineData,
    isLoading: isLoadingBaseline,
    isError: isBaselineError,
    refetch: refetchBaseline,
  } = useGitFileBaselineQuery(sandboxId, gitRelativePath ?? undefined, cwd, {
    enabled: viewMode === 'diff' && !!sandboxId && !!gitRelativePath,
  });

  const { data: changedPathsData } = useGitChangedPathsQuery(sandboxId, cwd);

  const error = fileContentError
    ? fileContentError instanceof Error
      ? fileContentError.message
      : 'Failed to load file content'
    : null;

  const language = selectedFile ? detectLanguage(selectedFile.path) : 'javascript';
  const displayHasUnsavedChanges = hasLoadedSelectedFile && hasUnsavedChanges;

  const fileChangedInGit = !!gitRelativePath && !!changedPathsData?.paths.includes(gitRelativePath);
  // Whether the diff view has anything to show: uncommitted disk changes or an
  // unsaved draft (the diff compares HEAD against the live buffer).
  const fileHasChanges = displayHasUnsavedChanges || fileChangedInGit;

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
      monacoRef.current = monaco;
      setupEditorTheme(monaco);
      setupEditorNavigation(monaco);
      // A sandbox-less context is inert (contextForResource rejects it), so
      // attaching unconditionally is safe and picks up a late-arriving sandbox.
      attachEditorNavigationContext(editor, navigationContext.current);
      attachAddSelectionToChat(monaco, editor, navigationContext.current);
      attachAskAboutSelection(monaco, editor, openInlineChat);
      setMountedEditorPath(selectedFilePath);
    },
    [selectedFilePath, setupEditorTheme, openInlineChat],
  );

  const lastAppliedTargetRef = useRef<string>('');

  useEffect(() => {
    // Reveal + select the requested line after Monaco's model has absorbed the
    // loaded content. @monaco-editor/react syncs `value` -> model inside its
    // own effect; rAF lets that flush before we reveal, otherwise the editor
    // would still hold the old model and the line would be clamped wrong.
    if (!targetLine || !selectedFile) return;
    if (selectedFile.path !== targetLine.path) return;
    // Dedupe by the requested target, not the resolved/clamped line — after a
    // jump to line 100, editing the file down to fewer lines shouldn't re-fire
    // the same target and yank focus back to the clamped position.
    const key = `${targetLine.path}:${targetLine.line}:${targetLine.nonce}`;
    if (lastAppliedTargetRef.current === key) return;
    // Jumps land in the code editor — leave preview/diff so it can mount and
    // apply. Idempotent, so re-runs while the target is pending are no-ops.
    setViewMode('code');
    if (selectedFileContent === undefined) return;
    if (mountedEditorPath !== selectedFile.path) return;
    const editor = editorRef.current;
    if (!editor) return;

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
  const prevViewModeRef = useRef(viewMode);
  const prevFilePathRef = useRef(selectedFile?.path);

  // Reset fullscreen when the mode or file changes
  if (prevViewModeRef.current !== viewMode || prevFilePathRef.current !== selectedFile?.path) {
    const fileChanged = prevFilePathRef.current !== selectedFile?.path;
    const enteredDiff = prevViewModeRef.current !== 'diff' && viewMode === 'diff';
    prevViewModeRef.current = viewMode;
    prevFilePathRef.current = selectedFile?.path;
    if (isPreviewFullscreen) {
      setIsPreviewFullscreen(false);
    }
    // Sole inline-chat reset: mode toggles and file switches all remount
    // Content, so the widget's captured editor would go stale either way.
    if (inlineChat !== null) setInlineChat(null);
    // Each file opens in its own default mode (preview for previewable types).
    if (fileChanged) {
      setViewMode(defaultViewMode(selectedFile));
    }
    if (enteredDiff) {
      // Content unmounts while the diff is shown; drop the disposed editor so
      // the jump-to-line effect waits for the remount instead of touching it.
      editorRef.current = null;
      if (mountedEditorPath !== null) setMountedEditorPath(null);
    }
  }

  const handleCloseInlineChat = useCallback(() => {
    setInlineChat(null);
  }, []);

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

  // While the listing is still pending (sandbox unresolved or metadata fetching),
  // keep the file rendering so its content (fetched in parallel) shows without
  // waiting. Once loaded — including a genuinely empty workspace — tree
  // membership decides, so stale/deleted selections fall to EmptyState.
  const isTreePending = fileStructure.length === 0 && (!sandboxId || isSandboxSyncing);
  const isValidFile =
    selectedFile &&
    (isTreePending || findFileInStructure(fileStructure, selectedFile.path) !== undefined);

  const isPreviewable = selectedFile ? isPreviewableFile(selectedFile) : false;
  const isPreviewActive = isPreviewable && viewMode === 'preview';

  const handlePreviewToggle = (showPreviewState: boolean) => {
    setViewMode(showPreviewState ? 'preview' : 'code');
  };

  const handleToggleDiff = useCallback(() => {
    setViewMode((prev) => (prev === 'diff' ? 'code' : 'diff'));
  }, []);

  const handleRetryBaseline = useCallback(() => {
    void refetchBaseline().catch((err: unknown) => console.error(err));
  }, [refetchBaseline]);

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
            showPreview={isPreviewActive}
            onTogglePreview={handlePreviewToggle}
            showDiff={viewMode === 'diff'}
            onToggleDiff={handleToggleDiff}
            hasChanges={fileHasChanges}
            hasUnsavedChanges={displayHasUnsavedChanges}
            isSaving={updateFileMutation.isPending}
            onSave={handleUpdateFile}
            onToggleFileTree={onToggleFileTree}
            isFileTreeCollapsed={isFileTreeCollapsed}
            onToggleFullscreen={isPreviewActive ? handleTogglePreviewFullscreen : undefined}
          />

          <div className="relative flex-1 overflow-hidden">
            {isLoadingContent && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-secondary bg-opacity-75 dark:bg-surface-dark-secondary">
                <div className="text-sm text-text-secondary dark:text-text-dark-secondary">
                  Loading file content...
                </div>
              </div>
            )}

            {/* Listed before Content so its cleanup removes the content widget
                before @monaco-editor/react disposes the editor on unmount. */}
            {viewMode === 'code' &&
              inlineChat &&
              chatId &&
              editorRef.current &&
              monacoRef.current && (
                <InlineChatWidget
                  key={inlineChat.nonce}
                  monaco={monacoRef.current}
                  editor={editorRef.current}
                  chatId={chatId}
                  selection={inlineChat.selection}
                  onClose={handleCloseInlineChat}
                />
              )}

            {viewMode === 'diff' && (
              <DiffContent
                key={selectedFile.path}
                original={baselineData?.content}
                modified={displayContent}
                language={language}
                theme={currentTheme}
                isLoading={isLoadingBaseline}
                isError={isBaselineError}
                isGitRepo={baselineData?.is_git_repo ?? true}
                hasGitChanges={fileChangedInGit}
                onRetry={handleRetryBaseline}
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
                isReadOnly={updateFileMutation.isPending}
                onChange={handleEditorChange}
                onMount={handleEditorMount}
                theme={currentTheme}
              />
            )}

            {isPreviewActive && fileForPreview && (
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
