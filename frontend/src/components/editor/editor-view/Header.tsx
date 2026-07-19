import { memo } from 'react';
import {
  AlertTriangle,
  Code,
  FileText,
  GitCompareArrows,
  PanelLeft,
  Maximize2,
} from 'lucide-react';
import type { FileStructure } from '@/types/file-system.types';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import { SaveButton } from '@/components/ui/shared/SaveButton/SaveButton';
import { FileIcon } from '@/components/ui/shared/FileIcon/FileIcon';
import { isPreviewableFile } from '@/utils/fileTypes';
import { getFileName } from '@/utils/file';
import clsx from 'clsx';
import styles from './Header.module.scss';

export interface HeaderProps {
  filePath?: string;
  error: string | null;
  selectedFile?: FileStructure | null;
  showPreview?: boolean;
  onTogglePreview?: (showPreview: boolean) => void;
  showDiff?: boolean;
  onToggleDiff?: () => void;
  // Dot on Changes when there are uncommitted or unsaved edits.
  hasChanges?: boolean;
  hasUnsavedChanges?: boolean;
  isSaving?: boolean;
  onSave?: () => void;
  onToggleFileTree?: () => void;
  isFileTreeCollapsed?: boolean;
  onToggleFullscreen?: () => void;
}

export const Header = memo(function Header({
  filePath,
  error,
  selectedFile,
  showPreview = false,
  onTogglePreview,
  showDiff = false,
  onToggleDiff,
  hasChanges = false,
  hasUnsavedChanges = false,
  isSaving = false,
  onSave,
  onToggleFileTree,
  isFileTreeCollapsed = false,
  onToggleFullscreen,
}: HeaderProps) {
  const isPreviewable = selectedFile ? isPreviewableFile(selectedFile) : false;

  if (!filePath) return null;

  return (
    <div className={styles.header}>
      <div className={styles['header-left']}>
        {/* The close affordance lives in the FILES panel header — the editor only reopens. */}
        {onToggleFileTree && isFileTreeCollapsed && (
          <Button
            variant="unstyled"
            onClick={onToggleFileTree}
            className={styles['toggle-tree']}
            aria-label="Open file tree"
          >
            <PanelLeft size={14} />
          </Button>
        )}
        <FileIcon name={getFileName(filePath)} className={styles['header-file-icon']} />
        <span className={styles['header-path']}>{filePath}</span>
      </div>

      <div className={styles['header-actions']}>
        {error && (
          <div className={styles['header-error']}>
            <AlertTriangle className={styles['icon-sm']} />
            <span className={styles['header-error-text']}>{error}</span>
          </div>
        )}

        {onSave && hasUnsavedChanges && <SaveButton onClick={onSave} isSaving={isSaving} />}

        {onToggleDiff && (
          <Button
            onClick={onToggleDiff}
            variant="unstyled"
            className={clsx(styles.toggle, showDiff && styles['toggle--active'])}
          >
            <GitCompareArrows className={styles['icon-sm']} />
            Changes
            {hasChanges && <span className={styles['toggle-dot']} />}
          </Button>
        )}

        {isPreviewable && onTogglePreview && (
          <Button
            onClick={() => onTogglePreview(!showPreview)}
            variant="unstyled"
            className={clsx(styles.toggle, showPreview && styles['toggle--active'])}
          >
            {showPreview ? (
              <>
                <Code className={styles['icon-sm']} />
                Raw
              </>
            ) : (
              <>
                <FileText className={styles['icon-sm']} />
                Preview
              </>
            )}
          </Button>
        )}

        {showPreview && onToggleFullscreen && (
          <FloatingTooltip content="Enter fullscreen" className={styles['tooltip-wrap']}>
            <Button
              onClick={onToggleFullscreen}
              variant="unstyled"
              className={styles['fullscreen-button']}
              aria-label="Enter fullscreen"
            >
              <Maximize2 className={styles['icon-sm']} />
            </Button>
          </FloatingTooltip>
        )}
      </div>
    </div>
  );
});
