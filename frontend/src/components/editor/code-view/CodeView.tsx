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

    // Expand collapsed ancestor folders and scroll the selected file into view
    // via pierre's imperative handle. rAF lets the panel finish expanding first
    // so the tree has a non-zero viewport height to scroll within.
    const path = selectedFile.path;
    requestAnimationFrame(() => {
      treeRef.current?.expandAncestors(path);
      treeRef.current?.focusPath(path);
    });
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

  // Consume jumps dispatched from outside the editor (e.g. command menu search).
  // ChatPage handles the file selection via pendingFilePath; we only translate the
  // line nonce into local targetLine so View scrolls/highlights the line.
  const pendingFileJump = useUIStore((s) => s.pendingFileJump);
  useEffect(() => {
    // Only the editor of the jump's chat reacts — the other editor leaves it
    // for its own instance to claim.
    if (!pendingFileJump || pendingFileJump.chatId !== chatId) return;
    setTargetLine({
      path: pendingFileJump.path,
      line: pendingFileJump.line,
      nonce: pendingFileJump.nonce,
    });
    useUIStore.getState().consumeFileJump();
  }, [pendingFileJump, chatId]);

  // `openFileInEditor` (the write/edit tool buttons) only activates the editor tile;
  // expand the collapsed tree panel here, then scroll on the next frame so pierre's
  // scroll/highlight has a real viewport and doesn't race selectedFile's commit cycle.
  const pendingFilePath = useUIStore((s) => s.pendingFilePath);
  useEffect(() => {
    if (!pendingFilePath || pendingFilePath.chatId !== chatId) return;
    const path = pendingFilePath.path;
    const panel = fileTreePanelRef.current;
    if (panel && panel.isCollapsed()) panel.expand();
    requestAnimationFrame(() => {
      const file = findFileByToolPath(filesRef.current, path);
      const treePath = file?.path ?? path;
      treeRef.current?.expandAncestors(treePath);
      treeRef.current?.focusPath(treePath);
    });
  }, [pendingFilePath, chatId]);

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
            onToggleFileTree={() => setShowMobileTree(true)}
            targetLine={targetLine}
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
              onToggleFileTree={handleToggleFileTree}
              isFileTreeCollapsed={isFileTreeCollapsed}
              targetLine={targetLine}
            />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
});
