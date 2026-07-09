import { memo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import type { MessageAttachment } from '@/types/chat.types';
import { BaseModal } from './shared/BaseModal';
import { Button } from './primitives/Button/Button';
import { Spinner } from './primitives/Spinner/Spinner';

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

const navButtonClass =
  'absolute top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm transition-colors duration-200 hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70';

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
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5 dark:border-border-dark/50">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-xs font-medium text-text-primary dark:text-text-dark-primary">
            {filename}
          </p>
          {hasMultiple && (
            <span className="shrink-0 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              {currentIndex + 1} / {total}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => onDownload(current.file_url, filename)}
            aria-label="Download image"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label="Close preview"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="relative flex min-h-[60vh] items-center justify-center bg-surface-secondary dark:bg-surface-dark-secondary">
        {state?.isLoading && <Spinner size="md" className="text-text-tertiary" />}
        {state?.error && (
          <p className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
            Failed to load image
          </p>
        )}
        {state?.imageSrc && !state.error && (
          <img
            key={current.id}
            src={state.imageSrc}
            alt={filename}
            className="max-h-[80vh] max-w-full object-contain"
          />
        )}
        {hasMultiple && (
          <>
            <Button
              type="button"
              variant="unstyled"
              onClick={goPrev}
              className={`${navButtonClass} left-3`}
              aria-label="Previous image"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="unstyled"
              onClick={goNext}
              className={`${navButtonClass} right-3`}
              aria-label="Next image"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </BaseModal>
  );
}

export const ImagePreviewModal = memo(ImagePreviewModalInner);
