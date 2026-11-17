import { memo, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, ImageOff, X } from 'lucide-react';
import clsx from 'clsx';
import type { MessageAttachment } from '@/types/chat.types';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import {
  PreviewToolbar,
  PreviewToolbarButton,
} from '@/components/ui/PreviewToolbar/PreviewToolbar';
import type { ImageState } from '@/components/ui/attachment-viewer/AttachmentThumbnails';
import { useImageZoom } from './useImageZoom';
import { ZoomControls } from './ZoomControls';
import styles from './ImagePreviewModal.module.scss';

interface ImagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  attachments: MessageAttachment[];
  imageStates: Record<string, ImageState>;
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onDownload: (url: string | File, filename: string) => void;
  onRetry: (id: string) => void;
}

export const ImagePreviewModal = memo(function ImagePreviewModal({
  isOpen,
  onClose,
  attachments,
  imageStates,
  currentIndex,
  onIndexChange,
  onDownload,
  onRetry,
}: ImagePreviewModalProps) {
  const total = attachments.length;
  const hasMultiple = total > 1;
  const current = attachments[currentIndex];
  const state = current ? imageStates[current.id] : undefined;
  const zoom = useImageZoom(current ? `${current.id}:${state?.imageSrc}` : '', onClose);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const goPrev = () => onIndexChange((currentIndex - 1 + total) % total);
  const goNext = () => onIndexChange((currentIndex + 1) % total);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const action = {
        ArrowLeft: hasMultiple ? goPrev : undefined,
        ArrowRight: hasMultiple ? goNext : undefined,
        '+': zoom.zoomIn,
        '=': zoom.zoomIn,
        '-': zoom.zoomOut,
        '0': zoom.fit,
        '1': zoom.actual,
      }[e.key];
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  if (!isOpen || !current) return null;

  const filename = current.filename || `image-${currentIndex + 1}`;
  const hasError =
    Boolean(state?.error) || (state?.imageSrc !== undefined && failedSrc === state.imageSrc);
  const isLoading = !hasError && (state?.isLoading || (Boolean(state?.imageSrc) && !zoom.isReady));

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      variant="lightbox"
      ariaLabel={`Image preview: ${filename}`}
    >
      <div className={styles.lightbox}>
        <PreviewToolbar
          tone="scrim"
          title={filename}
          meta={
            <>
              {zoom.natural && (
                <span className={styles.dimensions}>
                  {zoom.natural.width} × {zoom.natural.height}
                </span>
              )}
              {hasMultiple && (
                <span>
                  {currentIndex + 1} / {total}
                </span>
              )}
            </>
          }
        >
          <ZoomControls zoom={zoom} className={styles.zoom} />
          <PreviewToolbarButton
            label="Download"
            icon={Download}
            onClick={() => onDownload(current.file_url, filename)}
            disabled={hasError}
          />
          <PreviewToolbarButton label="Close" shortcut="Esc" icon={X} onClick={onClose} />
        </PreviewToolbar>
        <div className={clsx(styles.body, hasMultiple && styles['body--gallery'])}>
          <div
            ref={zoom.stageRef}
            className={clsx(
              styles.stage,
              zoom.zoom !== 'fit' && styles['stage--zoomed'],
              zoom.isDragging && styles['stage--dragging'],
            )}
            {...zoom.stageHandlers}
          >
            {state?.imageSrc && !hasError && (
              <img
                key={state.imageSrc}
                ref={zoom.imageRef}
                src={state.imageSrc}
                alt={filename}
                draggable={false}
                onLoad={zoom.onImageLoad}
                onError={() => setFailedSrc(state.imageSrc)}
                style={zoom.imageStyle}
                className={clsx(
                  styles.image,
                  !zoom.isReady && styles['image--pending'],
                  zoom.canToggle &&
                    styles[zoom.zoom === 'fit' ? 'image--zoom-in' : 'image--zoom-out'],
                )}
              />
            )}
          </div>
          {isLoading && <Spinner size="md" className={styles.status} />}
          {hasError && (
            <div className={styles.status}>
              <ImageOff className={styles['status-icon']} />
              <p className={styles['status-text']}>Couldn't load this image</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onRetry(current.id)}
                className={styles.retry}
              >
                Retry
              </Button>
            </div>
          )}
          {hasMultiple && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={goPrev}
                className={clsx(styles.nav, styles['nav--prev'])}
                aria-label="Previous image"
              >
                <ChevronLeft className={styles['nav-icon']} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={goNext}
                className={clsx(styles.nav, styles['nav--next'])}
                aria-label="Next image"
              >
                <ChevronRight className={styles['nav-icon']} />
              </Button>
            </>
          )}
        </div>
      </div>
    </BaseModal>
  );
});
