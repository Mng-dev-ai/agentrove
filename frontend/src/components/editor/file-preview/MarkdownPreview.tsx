import { memo } from 'react';
import clsx from 'clsx';
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
      // 'prose'/'max-w-none'/'dark:prose-invert' come from the Tailwind Typography plugin
      // (tailwind.config.js) — no SCSS token exists for its nested markdown ruleset, and
      // config edits are out of scope for this migration, so these stay literal Tailwind.
      contentClassName={clsx(styles.content, 'prose max-w-none dark:prose-invert')}
    >
      <LazyMarkDown content={file.content} />
    </PreviewContainer>
  );
});
