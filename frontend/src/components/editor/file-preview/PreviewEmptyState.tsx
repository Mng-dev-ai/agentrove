import { memo } from 'react';
import type { FileStructure } from '@/types/file-system.types';
import { PreviewContainer } from './PreviewContainer';
import styles from './PreviewEmptyState.module.scss';

interface PreviewEmptyStateProps {
  file: FileStructure;
  fileName: string;
  message: string;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const PreviewEmptyState = memo(function PreviewEmptyState({
  file,
  fileName,
  message,
  isFullscreen,
  onToggleFullscreen,
}: PreviewEmptyStateProps) {
  return (
    <PreviewContainer
      file={file}
      fileName={fileName}
      isFullscreen={isFullscreen}
      onToggleFullscreen={onToggleFullscreen}
      contentClassName={styles.content}
    >
      <p className={styles.message}>{message}</p>
    </PreviewContainer>
  );
});
