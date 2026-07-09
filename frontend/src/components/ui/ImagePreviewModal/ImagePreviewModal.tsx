import { memo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import clsx from 'clsx';
import type { MessageAttachment } from '@/types/chat.types';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import styles from './ImagePreviewModal.module.scss';

interface ImageState {
  isLoading: boolean;
  error: boolean;
  imageSrc: string;
}

interface ImagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  attachments: MessageAttachment[];
  imageStates: Record<string, ImageState>;
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onDownload: (url: string, filename: string) => void;
}

function ImagePreviewModalInner({
  isOpen,
  onClose,
  attachments,
  imageStates,
  currentIndex,
  onIndexChange,
  onDownload,
}: ImagePreviewModalProps) {
  const total = attachments.length;
  const hasMultiple = total > 1;
  const current = attachments[currentIndex];
  const goPrev = () => onIndexChange((currentIndex - 1 + total) % total);
  const goNext = () => onIndexChange((currentIndex + 1) % total);

  useEffect(() => {
    if (!isOpen || !hasMultiple) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // goPrev/goNext are fresh closures each render; currentIndex changing is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, hasMultiple, currentIndex, total, onIndexChange]);

  if (!isOpen || !current) return null;

  const state = imageStates[current.id];
  const filename = current.filename || `image-${currentIndex + 1}`;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="4xl"
      ariaLabel={`Image preview: ${filename}`}
    >
      <div className={styles.header}>
        <div className={styles['title-group']}>
          <p className={styles.filename}>{filename}</p>
          {hasMultiple && (
            <span className={styles.counter}>
              {currentIndex + 1} / {total}
            </span>
          )}
        </div>
        <div className={styles.actions}>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => onDownload(current.file_url, filename)}
            aria-label="Download image"
          >
            <Download className={styles.icon} />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label="Close preview"
          >
            <X className={styles.icon} />
          </Button>
        </div>
      </div>
      <div className={styles.stage}>
        {state?.isLoading && <Spinner size="md" className={styles['error-text']} />}
        {state?.error && <p className={styles['error-text']}>Failed to load image</p>}
        {state?.imageSrc && !state.error && (
          <img key={current.id} src={state.imageSrc} alt={filename} className={styles.image} />
        )}
        {hasMultiple && (
          <>
            <Button
              type="button"
              variant="unstyled"
              onClick={goPrev}
              className={clsx(styles['nav-button'], styles['nav-button--left'])}
              aria-label="Previous image"
            >
              <ChevronLeft className={styles['nav-icon']} />
            </Button>
            <Button
              type="button"
              variant="unstyled"
              onClick={goNext}
              className={clsx(styles['nav-button'], styles['nav-button--right'])}
              aria-label="Next image"
            >
              <ChevronRight className={styles['nav-icon']} />
            </Button>
          </>
        )}
      </div>
    </BaseModal>
  );
}

export const ImagePreviewModal = memo(ImagePreviewModalInner);
