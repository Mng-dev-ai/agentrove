import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { CodeSidebar } from '../code-sidebar/CodeSidebar';
import type { TreeHandle } from '../file-tree/Tree';
import { View } from '../editor-view/View';
import type { FileStructure } from '@/types/file-system.types';
import { cn } from '@/utils/cn';
import { findFileByToolPath, findFileInStructure } from '@/utils/file';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useMountEffect } from '@/hooks/useMountEffect';
import { useUIStore } from '@/store/uiStore';

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
  theme,
  sandboxId,
  cwd,
  onDownload,
  isDownloading,
  isSandboxSyncing = false,
  onRefresh,
  isRefreshing = false,
  chatId,
}: CodeViewProps) {
  const backgroundClass = theme === 'light' ? 'bg-surface-secondary' : 'bg-surface-dark-secondary';
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

  const handleFileTreeExpand = useCallback(() => {
    setIsFileTreeCollapsed(false);
    if (!selectedFile || selectedFile.type !== 'file') return;
    // reveal() waits for the just-expanded panel to lay out before scrolling, so
    // the selected file is brought into view even though expansion isn't instant.
    treeRef.current?.reveal(selectedFile.path);
  }, [selectedFile]);

  const handleMobileFileSelect = useCallback(
    (file: FileStructure | null) => {
      const isSameFile = file?.path === selectedFile?.path;
      // Pierre replays the current selection when the mobile tree mounts; keep that
      // sync from immediately closing the just-opened drawer.
      if (!isSameFile) onFileSelect(file);
      if (file && file.type === 'file' && !isSameFile) {
        setShowMobileTree(false);
      }
    },
    [onFileSelect, selectedFile?.path],
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
      onFileSelect(file);
      // Each click re-navigates even when path+line match the last one,
      // so re-clicking a result re-reveals it after the user scrolls away.
      setTargetLine((prev) => ({
        path,
        line: lineNumber,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
      if (isMobile) setShowMobileTree(false);
    },
    [onFileSelect, isMobile],
  );

  // `openFileInEditor` (tool buttons, command menu, changed-files) activates the
  // editor tile; this editor instance claims only opens for its chat.
  const pendingFileOpen = useUIStore((s) => s.pendingFileOpen);
  useEffect(() => {
    if (!pendingFileOpen || pendingFileOpen.chatId !== chatId) return;
    if (files.length === 0) return;
    const file = findFileByToolPath(filesRef.current, pendingFileOpen.path);
    const path = file?.path ?? pendingFileOpen.path;
    onFileSelect(file ?? { path, type: 'file', content: '' });
    const panel = fileTreePanelRef.current;
    if (panel && panel.isCollapsed()) panel.expand();
    treeRef.current?.reveal(path);
    if (pendingFileOpen.line != null) {
      setTargetLine({ path, line: pendingFileOpen.line, nonce: pendingFileOpen.nonce });
    }
    useUIStore.setState({ pendingFileOpen: null });
  }, [pendingFileOpen, chatId, onFileSelect, files.length]);

  const sharedSidebarProps = {
    files,
    selectedFile,
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
      <div className={cn('relative flex min-h-0 flex-1 flex-col overflow-hidden', backgroundClass)}>
        {showMobileTree && (
          <>
            <div
              className="absolute inset-0 z-20 bg-black/50"
              onClick={() => setShowMobileTree(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setShowMobileTree(false);
              }}
              role="presentation"
            />
            <div
              data-code-sidebar
              className={cn(
                'absolute left-0 top-0 z-30 h-full w-72',
                'border-r border-border dark:border-border-dark',
                backgroundClass,
              )}
            >
              <CodeSidebar {...sharedSidebarProps} onFileSelect={handleMobileFileSelect} />
            </div>
          </>
        )}

        <div className={cn('min-h-0 flex-1 overflow-hidden', backgroundClass)}>
          <View
            selectedFile={selectedFile}
            fileStructure={files}
            sandboxId={sandboxId}
            chatId={chatId}
            cwd={cwd}
            onToggleFileTree={() => setShowMobileTree(true)}
            isSandboxSyncing={isSandboxSyncing}
            targetLine={targetLine}
            openFiles={openFiles}
            onFileSelect={onFileSelect}
            onCloseFile={onCloseFile}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
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
          <div
            data-code-sidebar
            className={`h-full overflow-hidden border-r border-border dark:border-border-dark ${backgroundClass}`}
          >
            <CodeSidebar {...sharedSidebarProps} onFileSelect={onFileSelect} />
          </div>
        </Panel>

        <PanelResizeHandle
          className={cn(
            'group relative w-px',
            'bg-border/50 dark:bg-border-dark/50',
            'hover:bg-text-quaternary/50 dark:hover:bg-text-dark-quaternary/50',
            'transition-colors duration-200',
          )}
        >
          <div className="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize" />
        </PanelResizeHandle>

        <Panel>
          <div className={`h-full overflow-hidden ${backgroundClass}`}>
            <View
              selectedFile={selectedFile}
              fileStructure={files}
              sandboxId={sandboxId}
              chatId={chatId}
              cwd={cwd}
              onToggleFileTree={handleToggleFileTree}
              isFileTreeCollapsed={isFileTreeCollapsed}
              isSandboxSyncing={isSandboxSyncing}
              targetLine={targetLine}
              openFiles={openFiles}
              onFileSelect={onFileSelect}
              onCloseFile={onCloseFile}
            />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
});
