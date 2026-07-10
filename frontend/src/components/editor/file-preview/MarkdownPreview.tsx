import { memo } from 'react';
import { LazyMarkDown } from '@/components/ui/markdown/LazyMarkDown';
import type { FileStructure } from '@/types/file-system.types';
import { PreviewContainer } from './PreviewContainer';
import { getDisplayFileName } from './previewUtils';
import styles from './MarkdownPreview.module.scss';

export interface MarkdownPreviewProps {
  file: FileStructure;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const MarkdownPreview = memo(function MarkdownPreview({
  file,
  isFullscreen = false,
  onToggleFullscreen,
}: MarkdownPreviewProps) {
  return (
    <PreviewContainer
      fileName={getDisplayFileName(file)}
      isFullscreen={isFullscreen}
      onToggleFullscreen={onToggleFullscreen}
      contentClassName={styles.content}
    >
      <LazyMarkDown content={file.content} />
    </PreviewContainer>
  );
});
