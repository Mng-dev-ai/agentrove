import { memo, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { FileStructure } from '@/types/file-system.types';
import { Button } from '@/components/ui/primitives/Button';
import { FileIcon } from '@/components/ui/shared/FileIcon';
import { getFileName } from '@/utils/file';
import { cn } from '@/utils/cn';

export interface EditorTabsProps {
  openFiles: FileStructure[];
  selectedPath: string | null;
  // Paths with unsaved edits — any open tab can be dirty, not just the active one,
  // since View preserves a per-file draft buffer across tab switches.
  dirtyPaths: ReadonlySet<string>;
  onSelect: (file: FileStructure) => void;
  onClose: (path: string) => void;
}

export const EditorTabs = memo(function EditorTabs({
  openFiles,
  selectedPath,
  dirtyPaths,
  onSelect,
  onClose,
}: EditorTabsProps) {
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedPath]);

  if (openFiles.length === 0) return null;

  return (
    <div
      role="tablist"
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border/50 dark:border-border-dark/50"
    >
      {openFiles.map((file) => {
        const isActive = file.path === selectedPath;
        const name = getFileName(file.path);
        // A dirty tab shows the unsaved dot at rest, swapped for the close button on hover.
        const showDot = dirtyPaths.has(file.path);
        return (
          <div
            key={file.path}
            className={cn(
              'group relative flex shrink-0 items-stretch border-r border-border/30 transition-colors duration-200 dark:border-border-dark/30',
              !isActive && 'hover:bg-surface-hover dark:hover:bg-surface-dark-hover',
            )}
          >
            {/* Select and close are sibling buttons (not nested) so both are keyboard-operable. */}
            <Button
              ref={isActive ? activeTabRef : undefined}
              variant="unstyled"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(file)}
              className={cn(
                'flex items-center gap-1.5 py-0 pl-3 pr-1 font-mono text-2xs transition-colors duration-200 focus-visible:relative focus-visible:z-10',
                isActive
                  ? 'text-text-primary dark:text-text-dark-primary'
                  : 'text-text-tertiary hover:text-text-secondary dark:text-text-dark-tertiary dark:hover:text-text-dark-secondary',
              )}
            >
              <FileIcon name={name} className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[12rem] truncate">{name}</span>
            </Button>
            <span className="relative flex w-6 items-center justify-center">
              {showDot && (
                <span className="absolute h-1.5 w-1.5 rounded-full bg-text-quaternary group-hover:hidden dark:bg-text-dark-quaternary" />
              )}
              <Button
                variant="unstyled"
                onClick={() => onClose(file.path)}
                aria-label={`Close ${name}`}
                className={cn(
                  'rounded p-0.5 text-text-quaternary transition-colors duration-150 hover:text-text-primary focus-visible:opacity-100 group-hover:opacity-100 dark:text-text-dark-quaternary dark:hover:text-text-dark-primary',
                  isActive && !showDot ? 'opacity-100' : 'opacity-0',
                )}
              >
                <X className="h-3 w-3" />
              </Button>
            </span>
            {isActive && (
              <span className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-text-primary dark:bg-text-dark-primary" />
            )}
          </div>
        );
      })}
    </div>
  );
});
