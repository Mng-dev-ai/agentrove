import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { CodeSidebar } from '../code-sidebar/CodeSidebar';
import type { TreeHandle } from '../file-tree/Tree';
import { View } from '../editor-view/View';
import type { FileStructure } from '@/types/file-system.types';
import {
  buildFileStructureFromSandboxFiles,
  findFileByToolPath,
  findFileInStructure,
} from '@/utils/file';
import { useFilesMetadataQuery } from '@/hooks/queries/useSandboxQueries';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useUIStore, type ForeignFileTarget } from '@/store/uiStore';
import styles from './CodeView.module.scss';

export interface CodeViewProps {
  files: FileStructure[];
  selectedFile: FileStructure | null;
  onFileSelect: (file: FileStructure | null) => void;
  openFiles: FileStructure[];
  onCloseFile: (path: string) => void;
  theme: string;
  sandboxId?: string;
  cwd?: string;
  onDownload?: () => void;
  isDownloading?: boolean;
  isSandboxSyncing?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  chatId: string | undefined;
}

export const CodeView = memo(function CodeView({
  files,
  selectedFile,
  onFileSelect,
  openFiles,
  onCloseFile,
  // Background now comes from --theme-surface-secondary, which already tracks
  // the active theme via :root[data-theme] — no need to branch on it here.
  sandboxId,
  cwd,
  onDownload,
  isDownloading,
  isSandboxSyncing = false,
  onRefresh,
  isRefreshing = false,
  chatId,
}: CodeViewProps) {
  const isMobile = useIsMobile();
  const [showMobileTree, setShowMobileTree] = useState(false);
  const fileTreePanelRef = useRef<ImperativePanelHandle>(null);
  const treeRef = useRef<TreeHandle>(null);
  const [isFileTreeCollapsed, setIsFileTreeCollapsed] = useState(true);
  const [targetLine, setTargetLine] = useState<{
    path: string;
    line: number;
    nonce: number;
  } | null>(null);
  const [foreignFile, setForeignFile] = useState<ForeignFileTarget | null>(null);
  const [foreignFileScope, setForeignFileScope] = useState({
    chatId,
    selectedPath: selectedFile?.path,
  });
  if (foreignFileScope.chatId !== chatId || foreignFileScope.selectedPath !== selectedFile?.path) {
    setForeignFileScope({ chatId, selectedPath: selectedFile?.path });
    setForeignFile(null);
  }
  const { data: foreignFilesMetadata, isLoading: isForeignFilesLoading } = useFilesMetadataQuery(
    foreignFile?.sandboxId,
  );
  const foreignFiles = useMemo(
    () => buildFileStructureFromSandboxFiles(foreignFilesMetadata ?? []),
    [foreignFilesMetadata],
  );
  const foreignRelPath = foreignFile?.relPath;
  const foreignTreeFile = useMemo<FileStructure | null>(
    () => (foreignRelPath ? { path: foreignRelPath, type: 'file', content: '' } : null),
    [foreignRelPath],
  );
  const treeSelectedFile = foreignFile ? foreignTreeFile : selectedFile;

  const handleFileSelect = useCallback(
    (file: FileStructure | null) => {
      setForeignFile(null);
      onFileSelect(file);
    },
    [onFileSelect],
  );

  const handleForeignFileSelect = useCallback(
    (file: FileStructure | null) => {
      if (!file || !foreignFile || file.path === foreignFile.relPath) return;
      setForeignFile({
        ...foreignFile,
        relPath: file.path,
        path: `${foreignFile.workspaceRoot}/${file.path}`,
      });
    },
    [foreignFile],
  );
  const handleTreeFileSelect = foreignFile ? handleForeignFileSelect : handleFileSelect;

  const handleExitForeignFile = useCallback(() => setForeignFile(null), []);
  const foreignWorkspaceName = foreignFile?.workspaceName;
  const readOnlyWorkspace = useMemo(
    () =>
      foreignWorkspaceName
        ? { name: foreignWorkspaceName, onExit: handleExitForeignFile }
        : undefined,
    [foreignWorkspaceName, handleExitForeignFile],
  );

  useMountEffect(() => {
    // Sync the flag with the panel's actual restored state: autoSaveId can override defaultSize,
    // so a returning user's saved-expanded layout would otherwise leave isFileTreeCollapsed=true
    // and desync the View's toggle button from reality.
    const panel = fileTreePanelRef.current;
    if (panel && !panel.isCollapsed()) {
      setIsFileTreeCollapsed(false);
    }
  });

  const handleToggleFileTree = useCallback(() => {
    const panel = fileTreePanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand();
    } else {
      panel.collapse();
    }
  }, []);

  const handleCloseMobileTree = useCallback(() => setShowMobileTree(false), []);

  const handleFileTreeExpand = useCallback(() => {
    setIsFileTreeCollapsed(false);
    if (!treeSelectedFile || treeSelectedFile.type !== 'file') return;
    // reveal() waits for the just-expanded panel to lay out before scrolling, so
    // the selected file is brought into view even though expansion isn't instant.
    treeRef.current?.reveal(treeSelectedFile.path);
  }, [treeSelectedFile]);

  const handleMobileFileSelect = useCallback(
    (file: FileStructure | null) => {
      const isSameFile = file?.path === treeSelectedFile?.path;
      // Pierre replays the current selection when the mobile tree mounts; keep that
      // sync from immediately closing the just-opened drawer.
      if (!isSameFile) handleTreeFileSelect(file);
      if (file && file.type === 'file' && !isSameFile) {
        setShowMobileTree(false);
      }
    },
    [handleTreeFileSelect, treeSelectedFile?.path],
  );

  // Read the latest file tree through a ref so handleOpenResult stays
  // stable across file-tree refreshes — keeps the memo'd CodeSidebar from
  // re-rendering every time files change.
  const filesRef = useRef(files);
  filesRef.current = files;

  const handleOpenResult = useCallback(
    (path: string, lineNumber: number) => {
      const file = findFileInStructure(filesRef.current, path);
      if (!file) return;
      handleFileSelect(file);
      // Each click re-navigates even when path+line match the last one,
      // so re-clicking a result re-reveals it after the user scrolls away.
      setTargetLine((prev) => ({
        path,
        line: lineNumber,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
      if (isMobile) setShowMobileTree(false);
    },
    [handleFileSelect, isMobile],
  );

  // `openFileInEditor` (tool buttons, command menu, changed-files) activates the
  // editor tile; this editor instance claims only opens for its chat.
  const pendingFileOpen = useUIStore((s) => s.pendingFileOpen);
  useEffect(() => {
    if (!pendingFileOpen || pendingFileOpen.chatId !== chatId) return;
    const { target, line } = pendingFileOpen;
    if (target.kind === 'foreign') {
      setForeignFile(target);
      if (line != null) {
        setTargetLine((prev) => ({ path: target.path, line, nonce: (prev?.nonce ?? 0) + 1 }));
      }
      useUIStore.setState({ pendingFileOpen: null });
      return;
    }
    if (files.length === 0) return;
    const file = findFileByToolPath(filesRef.current, target.path);
    const path = file?.path ?? target.path;
    handleFileSelect(file ?? { path, type: 'file', content: '' });
    // Respect a collapsed file tree — opening a file shouldn't reopen it;
    // handleFileTreeExpand re-reveals the selection if the user expands later.
    if (!fileTreePanelRef.current?.isCollapsed()) treeRef.current?.reveal(path);
    if (line != null) {
      // Share handleOpenResult's counter — a second nonce sequence could
      // collide in View's path:line:nonce dedupe and skip the jump.
      setTargetLine((prev) => ({ path, line, nonce: (prev?.nonce ?? 0) + 1 }));
    }
    useUIStore.setState({ pendingFileOpen: null });
  }, [pendingFileOpen, chatId, handleFileSelect, files.length]);

  const sidebarKey = foreignFile?.sandboxId ?? 'local';
  const sharedSidebarProps = foreignFile
    ? {
        files: foreignFiles,
        selectedFile: treeSelectedFile,
        onOpenResult: handleOpenResult,
        isSandboxSyncing: isForeignFilesLoading,
        sandboxId: foreignFile.sandboxId,
        treeRef,
        readOnlyWorkspace,
      }
    : {
        files,
        selectedFile: treeSelectedFile,
        onOpenResult: handleOpenResult,
        onDownload,
        isDownloading,
        isSandboxSyncing,
        onRefresh,
        isRefreshing,
        sandboxId,
        cwd,
        treeRef,
      };

  if (isMobile) {
    return (
      <div className={clsx(styles['code-view'], styles['code-view--mobile'])}>
        {showMobileTree && (
          <>
            <div
              className={styles['code-view__mobile-backdrop']}
              onClick={() => setShowMobileTree(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setShowMobileTree(false);
              }}
              role="presentation"
            />
            <div data-code-sidebar className={styles['code-view__mobile-drawer']}>
              <CodeSidebar
                key={sidebarKey}
                {...sharedSidebarProps}
                onFileSelect={handleMobileFileSelect}
                onCollapse={handleCloseMobileTree}
              />
            </div>
          </>
        )}

        <div className={styles['code-view__mobile-content']}>
          <View
            selectedFile={selectedFile}
            foreignFile={foreignFile}
            fileStructure={files}
            sandboxId={sandboxId}
            chatId={chatId}
            cwd={cwd}
            onToggleFileTree={() => setShowMobileTree(true)}
            isFileTreeCollapsed={!showMobileTree}
            isSandboxSyncing={isSandboxSyncing}
            targetLine={targetLine}
            openFiles={openFiles}
            onFileSelect={handleFileSelect}
            onCloseFile={onCloseFile}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles['code-view']}>
      <PanelGroup direction="horizontal" autoSaveId="code-view-layout">
        <Panel
          ref={fileTreePanelRef}
          defaultSize={0}
          minSize={25}
          maxSize={40}
          collapsible
          collapsedSize={0}
          onCollapse={() => setIsFileTreeCollapsed(true)}
          onExpand={handleFileTreeExpand}
        >
          <div data-code-sidebar className={styles['code-view__tree-panel']}>
            <CodeSidebar
              key={sidebarKey}
              {...sharedSidebarProps}
              onFileSelect={handleTreeFileSelect}
              onCollapse={handleToggleFileTree}
            />
          </div>
        </Panel>

        <PanelResizeHandle className={styles['code-view__resize-handle']}>
          <div className={styles['code-view__resize-handle-hit-area']} />
        </PanelResizeHandle>

        <Panel>
          <div className={styles['code-view__content-panel']}>
            <View
              selectedFile={selectedFile}
              foreignFile={foreignFile}
              fileStructure={files}
              sandboxId={sandboxId}
              chatId={chatId}
              cwd={cwd}
              onToggleFileTree={handleToggleFileTree}
              isFileTreeCollapsed={isFileTreeCollapsed}
              isSandboxSyncing={isSandboxSyncing}
              targetLine={targetLine}
              openFiles={openFiles}
              onFileSelect={handleFileSelect}
              onCloseFile={onCloseFile}
            />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
});
