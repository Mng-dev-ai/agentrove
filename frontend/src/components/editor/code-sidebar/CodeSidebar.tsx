import { memo, useCallback, useMemo, useState, type Ref } from 'react';
import {
  ArrowLeft,
  Download,
  Loader2,
  MoreHorizontal,
  PanelLeftClose,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useDropdown } from '@/hooks/useDropdown';
import { Tree, type TreeHandle } from '../file-tree/Tree';
import { SearchPanel } from '../file-search/SearchPanel';
import { useGitChangedPathsQuery } from '@/hooks/queries/useSandboxQueries';
import type { FileStructure } from '@/types/file-system.types';
import { cn } from '@/utils/cn';

export interface CodeSidebarProps {
  files: FileStructure[];
  selectedFile: FileStructure | null;
  onFileSelect: (file: FileStructure) => void;
  onOpenResult: (path: string, lineNumber: number) => void;
  onDownload?: () => void;
  isDownloading?: boolean;
  isSandboxSyncing?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  sandboxId: string | undefined;
  cwd?: string;
  treeRef?: Ref<TreeHandle>;
  // Collapses the desktop panel / closes the mobile drawer — the caller decides which.
  onCollapse?: () => void;
}

type View = 'files' | 'search';

export const CodeSidebar = memo(function CodeSidebar({
  files,
  selectedFile,
  onFileSelect,
  onOpenResult,
  onDownload,
  isDownloading = false,
  isSandboxSyncing = false,
  onRefresh,
  isRefreshing = false,
  sandboxId,
  cwd,
  treeRef,
  onCollapse,
}: CodeSidebarProps) {
  const [view, setView] = useState<View>('files');

  const handleSearchFiles = useCallback(() => setView('search'), []);
  const handleBackToFiles = useCallback(() => setView('files'), []);

  // Git paths are cwd-relative while tree paths are workspace-root-relative —
  // re-prefix cwd so the change indicators match the tree's paths.
  const { data: changedPathsData } = useGitChangedPathsQuery(sandboxId, cwd);
  const modifiedPaths = useMemo(
    () => new Set((changedPathsData?.paths ?? []).map((p) => (cwd ? `${cwd}/${p}` : p))),
    [changedPathsData, cwd],
  );

  // Stable element preserves Tree's memo when unrelated sidebar props change.
  const treeHeader = useMemo(
    () => (
      <TreeHeader
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        onDownload={onDownload}
        isDownloading={isDownloading}
        onSearchFiles={handleSearchFiles}
        onCollapse={onCollapse}
      />
    ),
    [onRefresh, isRefreshing, onDownload, isDownloading, handleSearchFiles, onCollapse],
  );

  return (
    <div className="flex h-full flex-col bg-surface-secondary dark:bg-surface-dark-secondary">
      <div className={cn('min-h-0 flex-1', view !== 'files' && 'hidden')}>
        <Tree
          ref={treeRef}
          files={files}
          selectedFile={selectedFile}
          onFileSelect={onFileSelect}
          isSandboxSyncing={isSandboxSyncing}
          modifiedPaths={modifiedPaths}
          header={treeHeader}
        />
      </div>
      {view === 'search' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <SearchHeader onBack={handleBackToFiles} />
          <div className="min-h-0 flex-1">
            <SearchPanel sandboxId={sandboxId} cwd={cwd} onOpenResult={onOpenResult} />
          </div>
        </div>
      )}
    </div>
  );
});

interface TreeHeaderProps {
  onRefresh?: () => void;
  isRefreshing: boolean;
  onDownload?: () => void;
  isDownloading: boolean;
  onSearchFiles: () => void;
  onCollapse?: () => void;
}

function TreeHeader({
  onRefresh,
  isRefreshing,
  onDownload,
  isDownloading,
  onSearchFiles,
  onCollapse,
}: TreeHeaderProps) {
  const { isOpen, setIsOpen, dropdownRef } = useDropdown();

  const handleAction = useCallback(
    (action: () => void) => {
      action();
      setIsOpen(false);
    },
    [setIsOpen],
  );

  return (
    <div className="flex h-7 items-center justify-between px-3">
      <span className="text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
        Files
      </span>
      <div className="flex items-center gap-0.5">
        <div ref={dropdownRef} className="relative">
          <Button
            variant="unstyled"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-label="File tree options"
            aria-expanded={isOpen}
            className="rounded-md p-1 text-text-quaternary transition-colors duration-150 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
          >
            <MoreHorizontal className="h-3 w-3" />
          </Button>
          {isOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-20 mt-1 min-w-[160px] animate-fadeIn overflow-hidden rounded-lg border border-border/50 bg-surface-secondary/95 shadow-medium backdrop-blur-xl dark:border-border-dark/50 dark:bg-surface-dark-secondary/95"
            >
              <MenuItem
                icon={Search}
                label="Search in files"
                onClick={() => handleAction(onSearchFiles)}
              />
              {onRefresh && (
                <MenuItem
                  icon={isRefreshing ? Loader2 : RefreshCw}
                  iconSpinning={isRefreshing}
                  label="Refresh"
                  onClick={() => handleAction(onRefresh)}
                />
              )}
              {onDownload && (
                <MenuItem
                  icon={isDownloading ? Loader2 : Download}
                  iconSpinning={isDownloading}
                  label="Download"
                  onClick={() => handleAction(onDownload)}
                  disabled={isDownloading}
                />
              )}
            </div>
          )}
        </div>
        {onCollapse && (
          <Button
            variant="unstyled"
            onClick={onCollapse}
            aria-label="Close file tree"
            className="rounded-md p-1 text-text-quaternary transition-colors duration-150 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
          >
            <PanelLeftClose className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

interface MenuItemProps {
  icon: React.ComponentType<{ className?: string }>;
  iconSpinning?: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function MenuItem({ icon: Icon, iconSpinning, label, onClick, disabled }: MenuItemProps) {
  return (
    <Button
      variant="unstyled"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors duration-150',
        'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
        'dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary',
        'disabled:cursor-wait disabled:opacity-50',
      )}
    >
      <Icon className={cn('h-3 w-3 shrink-0', iconSpinning && 'animate-spin')} />
      {label}
    </Button>
  );
}

interface SearchHeaderProps {
  onBack: () => void;
}

function SearchHeader({ onBack }: SearchHeaderProps) {
  return (
    <div className="flex h-9 flex-none items-center gap-2 border-b border-border/50 px-3 dark:border-border-dark/50">
      <Button
        variant="unstyled"
        onClick={onBack}
        aria-label="Back to files"
        className="rounded-md p-1 text-text-quaternary transition-colors duration-150 hover:text-text-secondary dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary"
      >
        <ArrowLeft className="h-3 w-3" />
      </Button>
      <span className="text-2xs font-medium uppercase tracking-wider text-text-quaternary dark:text-text-dark-quaternary">
        Search
      </span>
    </div>
  );
}
