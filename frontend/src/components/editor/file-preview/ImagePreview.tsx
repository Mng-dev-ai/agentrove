import { memo, useMemo } from 'react';
import { logger } from '@/utils/logger';
import type { FileStructure } from '@/types/file-system.types';
import { useImageZoom } from '@/components/ui/ZoomableImage/useImageZoom';
import { ZoomControls } from '@/components/ui/ZoomableImage/ZoomControls';
import { ZoomableImage } from '@/components/ui/ZoomableImage/ZoomableImage';
import { PreviewContainer } from './PreviewContainer';
import { PreviewEmptyState } from './PreviewEmptyState';
import { getDisplayFileName, isValidBase64 } from './previewUtils';
import styles from './ImagePreview.module.scss';

export interface ImagePreviewProps {
  file: FileStructure;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const ImagePreview = memo(function ImagePreview({
  file,
  isFullscreen = false,
  onToggleFullscreen,
}: ImagePreviewProps) {
  const fileName = getDisplayFileName(file, 'image');
  const imageUrl = useMemo(() => {
    if (!file.content) return null;

    try {
      if (!isValidBase64(file.content)) {
        return null;
      }

      const lowercaseFileName = fileName.toLowerCase();
      let mimeType = 'image/jpeg';

      if (lowercaseFileName.endsWith('.png')) {
        mimeType = 'image/png';
      } else if (lowercaseFileName.endsWith('.gif')) {
        mimeType = 'image/gif';
      } else if (lowercaseFileName.endsWith('.webp')) {
        mimeType = 'image/webp';
      } else if (lowercaseFileName.endsWith('.svg')) {
        mimeType = 'image/svg+xml';
      } else if (lowercaseFileName.endsWith('.bmp')) {
        mimeType = 'image/bmp';
      } else if (lowercaseFileName.endsWith('.ico')) {
        mimeType = 'image/x-icon';
      }

      return `data:${mimeType};base64,${file.content}`;
    } catch (error) {
      logger.error('Image preview load failed', 'ImagePreview', error);
      return null;
    }
  }, [file.content, fileName]);
  const zoom = useImageZoom(imageUrl ?? '');

  if (!imageUrl || zoom.hasFailed) {
    return (
      <PreviewEmptyState
        file={file}
        fileName={fileName}
        message="Unable to load image"
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
      />
    );
  }

  return (
    <PreviewContainer
      file={file}
      fileName={fileName}
      isFullscreen={isFullscreen}
      onToggleFullscreen={onToggleFullscreen}
      disableContentWrapper
    >
      <div className={styles.preview}>
        <ZoomableImage
          zoom={zoom}
          src={imageUrl}
          alt={fileName}
          tone="surface"
          className={styles.stage}
        />
        <div className={styles.footer}>
          <span className={styles.dimensions}>
            {zoom.natural && `${zoom.natural.width} × ${zoom.natural.height}`}
          </span>
          <ZoomControls zoom={zoom} />
        </div>
      </div>
    </PreviewContainer>
  );
});
