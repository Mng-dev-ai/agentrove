import { memo, useCallback, useMemo, useState, type Ref } from 'react';
import clsx from 'clsx';
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
import styles from './CodeSidebar.module.scss';

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
    <div className={styles['code-sidebar']}>
      <div
        className={clsx(
          styles['code-sidebar__tree'],
          view !== 'files' && styles['code-sidebar__tree--hidden'],
        )}
      >
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
        <div className={styles['code-sidebar__search']}>
          <SearchHeader onBack={handleBackToFiles} />
          <div className={styles['code-sidebar__search-body']}>
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
    <div className={styles['tree-header']}>
      <span className={styles['section-label']}>Files</span>
      <div className={styles['tree-header__actions']}>
        <div ref={dropdownRef} className={styles['tree-header__menu']}>
          <Button
            variant="unstyled"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-label="File tree options"
            aria-expanded={isOpen}
            className={styles['icon-button']}
          >
            <MoreHorizontal className={styles.icon} />
          </Button>
          {isOpen && (
            <div role="menu" className={styles['tree-header__menu-panel']}>
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
            className={styles['icon-button']}
          >
            <PanelLeftClose className={styles.icon} />
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
      className={styles['menu-item']}
    >
      <Icon className={clsx(styles.icon, iconSpinning && styles['icon--spinning'])} />
      {label}
    </Button>
  );
}

interface SearchHeaderProps {
  onBack: () => void;
}

function SearchHeader({ onBack }: SearchHeaderProps) {
  return (
    <div className={styles['search-header']}>
      <Button
        variant="unstyled"
        onClick={onBack}
        aria-label="Back to files"
        className={styles['icon-button']}
      >
        <ArrowLeft className={styles.icon} />
      </Button>
      <span className={styles['section-label']}>Search</span>
    </div>
  );
}
