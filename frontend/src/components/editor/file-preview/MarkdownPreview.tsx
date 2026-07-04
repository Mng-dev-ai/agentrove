import { memo } from 'react';
import { LazyMarkDown } from '@/components/ui/LazyMarkDown';
import type { FileStructure } from '@/types/file-system.types';
import { PreviewContainer } from './PreviewContainer';
import { getDisplayFileName } from './previewUtils';

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
      contentClassName="overflow-auto p-6 prose max-w-none dark:prose-invert"
    >
      <LazyMarkDown content={file.content} />
    </PreviewContainer>
  );
});
