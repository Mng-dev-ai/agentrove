import { memo, useMemo, useState } from 'react';
import clsx from 'clsx';
import { logger } from '@/utils/logger';
import type { FileStructure } from '@/types/file-system.types';
import { useImageZoom } from '@/components/ui/ImagePreviewModal/useImageZoom';
import { ZoomControls } from '@/components/ui/ImagePreviewModal/ZoomControls';
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
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!imageUrl || failedUrl === imageUrl) {
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
        <div
          ref={zoom.stageRef}
          className={clsx(
            styles.stage,
            zoom.zoom !== 'fit' && styles['stage--zoomed'],
            zoom.isDragging && styles['stage--dragging'],
          )}
          {...zoom.stageHandlers}
        >
          <img
            key={imageUrl}
            ref={zoom.imageRef}
            src={imageUrl}
            alt={fileName}
            draggable={false}
            onLoad={zoom.onImageLoad}
            onError={() => setFailedUrl(imageUrl)}
            style={zoom.imageStyle}
            className={clsx(
              styles.image,
              !zoom.isReady && styles['image--pending'],
              zoom.canToggle && styles[zoom.zoom === 'fit' ? 'image--zoom-in' : 'image--zoom-out'],
            )}
          />
        </div>
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
