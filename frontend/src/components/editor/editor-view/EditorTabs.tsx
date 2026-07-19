import { memo, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { FileStructure } from '@/types/file-system.types';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FileIcon } from '@/components/ui/shared/FileIcon/FileIcon';
import { getFileName } from '@/utils/file';
import clsx from 'clsx';
import styles from './EditorTabs.module.scss';

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
    <div role="tablist" className={styles['editor-tabs']}>
      {openFiles.map((file) => {
        const isActive = file.path === selectedPath;
        const name = getFileName(file.path);
        const showDot = dirtyPaths.has(file.path);
        return (
          <div key={file.path} className={clsx(styles.tab, isActive && styles['tab--active'])}>
            {/* Select and close are sibling buttons (not nested) so both are keyboard-operable. */}
            <Button
              ref={isActive ? activeTabRef : undefined}
              variant="unstyled"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(file)}
              className={styles['tab-button']}
            >
              <FileIcon name={name} className={styles['tab-file-icon']} />
              <span className={styles['tab-name']}>{name}</span>
            </Button>
            <span className={styles['tab-close-slot']}>
              {showDot && <span className={styles['tab-dot']} />}
              <Button
                variant="unstyled"
                onClick={() => onClose(file.path)}
                aria-label={`Close ${name}`}
                className={clsx(
                  styles['tab-close'],
                  isActive && !showDot && styles['tab-close--visible'],
                )}
              >
                <X className={styles['tab-close-icon']} />
              </Button>
            </span>
            {isActive && <span className={styles['tab-underline']} />}
          </div>
        );
      })}
    </div>
  );
});
