import { memo } from 'react';
import { AlertTriangle, Code, FileText, PanelLeft, PanelLeftClose, Maximize2 } from 'lucide-react';
import type { FileStructure } from '@/types/file-system.types';
import { Button } from '@/components/ui/primitives/Button';
import { SaveButton } from '@/components/ui/shared/SaveButton';
import { FileIcon } from '@/components/ui/shared/FileIcon';
import { isPreviewableFile } from '@/utils/fileTypes';
import { getFileName } from '@/utils/file';
import { cn } from '@/utils/cn';

export interface HeaderProps {
  filePath?: string;
  error: string | null;
  selectedFile?: FileStructure | null;
  showPreview?: boolean;
  onTogglePreview?: (showPreview: boolean) => void;
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
  hasUnsavedChanges = false,
  isSaving = false,
  onSave,
  onToggleFileTree,
  isFileTreeCollapsed = false,
  onToggleFullscreen,
}: HeaderProps) {
  const ToggleIcon = isFileTreeCollapsed ? PanelLeft : PanelLeftClose;
  const isPreviewable = selectedFile ? isPreviewableFile(selectedFile) : false;

  if (!filePath) return null;

  return (
    <div className="flex h-9 items-center justify-between border-b border-border/50 bg-surface-secondary px-3 dark:border-border-dark/50 dark:bg-surface-dark-secondary">
      <div className="flex min-w-0 items-center gap-2">
        {onToggleFileTree && (
          <Button
            variant="unstyled"
            onClick={onToggleFileTree}
            className={cn(
              'shrink-0 rounded-md p-1',
              'text-text-quaternary hover:text-text-secondary',
              'dark:text-text-dark-quaternary dark:hover:text-text-dark-secondary',
              'transition-colors duration-150',
            )}
            aria-label={isFileTreeCollapsed ? 'Open file tree' : 'Close file tree'}
          >
            <ToggleIcon size={14} />
          </Button>
        )}
        <FileIcon name={getFileName(filePath)} className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate font-mono text-2xs text-text-tertiary dark:text-text-dark-tertiary">
          {filePath}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {error && (
          <div className="flex items-center gap-1 text-error-500 dark:text-error-400">
            <AlertTriangle className="h-3 w-3" />
            <span className="text-2xs">{error}</span>
          </div>
        )}

        {onSave && hasUnsavedChanges && <SaveButton onClick={onSave} isSaving={isSaving} />}

        {isPreviewable && onTogglePreview && (
          <Button
            onClick={() => onTogglePreview(!showPreview)}
            variant="unstyled"
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-medium transition-colors duration-200',
              showPreview
                ? 'bg-surface-active text-text-primary dark:bg-surface-dark-hover dark:text-text-dark-primary'
                : 'text-text-tertiary hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary',
            )}
          >
            {showPreview ? (
              <>
                <Code className="h-3 w-3" />
                Raw
              </>
            ) : (
              <>
                <FileText className="h-3 w-3" />
                Preview
              </>
            )}
          </Button>
        )}

        {showPreview && onToggleFullscreen && (
          <Button
            onClick={onToggleFullscreen}
            variant="unstyled"
            className="rounded-md p-1 text-text-tertiary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary dark:text-text-dark-tertiary dark:hover:bg-surface-dark-hover dark:hover:text-text-dark-primary"
            title="Enter fullscreen"
            aria-label="Enter fullscreen"
          >
            <Maximize2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
});
