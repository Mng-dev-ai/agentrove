import { memo } from 'react';
import { PreviewContainer } from './PreviewContainer';
import styles from './PreviewEmptyState.module.scss';

interface PreviewEmptyStateProps {
  fileName: string;
  message: string;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const PreviewEmptyState = memo(function PreviewEmptyState({
  fileName,
  message,
  isFullscreen,
  onToggleFullscreen,
}: PreviewEmptyStateProps) {
  return (
    <PreviewContainer
      fileName={fileName}
      isFullscreen={isFullscreen}
      onToggleFullscreen={onToggleFullscreen}
      contentClassName={styles.content}
    >
      <p className={styles.message}>{message}</p>
    </PreviewContainer>
  );
});
