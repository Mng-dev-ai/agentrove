import { memo, ReactNode } from 'react';
import clsx from 'clsx';
import { Download, Minimize2 } from 'lucide-react';
import type { FileStructure } from '@/types/file-system.types';
import {
  PreviewToolbar,
  PreviewToolbarButton,
} from '@/components/ui/PreviewToolbar/PreviewToolbar';
import { downloadPreviewFile } from './previewUtils';
import styles from './PreviewContainer.module.scss';

interface PreviewContainerProps {
  file: FileStructure;
  fileName: string;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  children: ReactNode;
  contentClassName?: string;
  disableContentWrapper?: boolean;
}

export const PreviewContainer = memo(function PreviewContainer({
  file,
  fileName,
  isFullscreen,
  onToggleFullscreen,
  children,
  contentClassName = '',
  disableContentWrapper = false,
}: PreviewContainerProps) {
  return (
    <div className={styles['preview-container']}>
      {isFullscreen && (
        <PreviewToolbar title={fileName}>
          <PreviewToolbarButton
            label="Download"
            icon={Download}
            onClick={() => downloadPreviewFile(file, fileName)}
            disabled={!file.content}
          />
          {onToggleFullscreen && (
            <PreviewToolbarButton
              label="Exit fullscreen"
              shortcut="Esc"
              icon={Minimize2}
              onClick={onToggleFullscreen}
            />
          )}
        </PreviewToolbar>
      )}

      {disableContentWrapper ? (
        children
      ) : (
        <div className={clsx(styles.content, contentClassName)}>{children}</div>
      )}
    </div>
  );
});
