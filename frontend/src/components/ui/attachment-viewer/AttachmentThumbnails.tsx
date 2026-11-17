import { memo, useState } from 'react';
import type { ReactNode, SyntheticEvent } from 'react';
import clsx from 'clsx';
import { Download, FileSpreadsheet, FileText, RotateCw } from 'lucide-react';
import type { MessageAttachment } from '@/types/chat.types';
import { getDefaultFilename } from '@/utils/file';
import { Button } from '../primitives/Button/Button';
import { Spinner } from '../primitives/Spinner/Spinner';
import styles from './AttachmentThumbnails.module.scss';

export interface ImageState {
  isLoading: boolean;
  error: boolean;
  imageSrc: string;
}

export type ImageSize = 'thumbnail' | 'large';

const getFileExtension = (filename: string): string =>
  filename.includes('.') ? (filename.split('.').pop()?.toUpperCase() ?? '') : '';

const LoadingProgressOverlay = memo(function LoadingProgressOverlay() {
  return (
    <div className={styles.overlay}>
      <div className={styles['overlay-center']}>
        <Spinner size="xs" className={styles['spinner-white']} />
      </div>
    </div>
  );
});

export function TileImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className: string;
}) {
  const [isSmall, setIsSmall] = useState(false);
  const handleLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const image = e.currentTarget;
    setIsSmall(image.naturalWidth < image.clientWidth || image.naturalHeight < image.clientHeight);
  };
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onLoad={handleLoad}
      className={clsx(styles['tile-image'], isSmall && styles['tile-image--small'], className)}
    />
  );
}

interface FileChipProps {
  filename: string;
  fileType: string;
  isLoading?: boolean;
  trailing: ReactNode;
}

export function FileChip({ filename, fileType, isLoading = false, trailing }: FileChipProps) {
  const Icon = fileType === 'xlsx' ? FileSpreadsheet : FileText;
  const tone = fileType === 'pdf' || fileType === 'xlsx' ? fileType : 'file';
  return (
    <span className={styles['file-chip']} title={filename}>
      <span className={clsx(styles['file-icon'], styles[`file-icon--${tone}`])}>
        {isLoading ? <Spinner size="xs" /> : <Icon className={styles['file-glyph']} />}
      </span>
      <span className={styles['file-text']}>
        <span className={styles['file-name']}>{filename}</span>
        <span className={styles['file-type']}>
          {getFileExtension(filename) || fileType.toUpperCase()}
        </span>
      </span>
      {trailing}
    </span>
  );
}

interface FileAttachmentProps {
  attachment: MessageAttachment;
  index: number;
  isUploading: boolean;
  onDownload: (url: string | File, filename: string) => void;
}

export function FileAttachment({
  attachment,
  index,
  isUploading,
  onDownload,
}: FileAttachmentProps) {
  const filename = attachment.filename || getDefaultFilename(attachment.file_type, index);
  return (
    <Button
      type="button"
      variant="unstyled"
      onClick={() => onDownload(attachment.file_url, filename)}
      disabled={isUploading}
      className={styles['file-button']}
      aria-label={`Download ${filename}`}
    >
      <FileChip
        filename={filename}
        fileType={attachment.file_type}
        isLoading={isUploading}
        trailing={<Download className={styles['file-download']} />}
      />
    </Button>
  );
}

interface ThumbnailWrapperProps {
  attachment: MessageAttachment;
  filename: string;
  onDownload: (url: string | File, filename: string) => void;
  onPreview?: () => void;
  children: ReactNode;
}

export function ThumbnailWrapper({
  attachment,
  filename,
  onDownload,
  onPreview,
  children,
}: ThumbnailWrapperProps) {
  const isInteractive = Boolean(onPreview);

  return (
    <div
      className={clsx(styles.thumbnail, isInteractive && styles['thumbnail--interactive'])}
      onClick={onPreview}
      onKeyDown={
        isInteractive
          ? (e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPreview?.();
              }
            }
          : undefined
      }
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? `Preview ${filename}` : undefined}
    >
      {children}
      <div className={styles['download-wrap']}>
        <Button
          type="button"
          variant="unstyled"
          onClick={(e) => {
            e.stopPropagation();
            onDownload(attachment.file_url, filename);
          }}
          className={styles['download-button']}
          aria-label={`Download ${filename}`}
        >
          <Download className={styles['download-icon']} />
        </Button>
      </div>
    </div>
  );
}

interface ImageThumbnailProps {
  filename: string;
  state: ImageState;
  isUploading: boolean;
  size: ImageSize;
}

export function ImageThumbnail({ filename, state, isUploading, size }: ImageThumbnailProps) {
  if (state.isLoading) {
    return (
      <div className={styles['image-loading']}>
        <LoadingProgressOverlay />
      </div>
    );
  }

  if (size === 'large') {
    return (
      <div className={styles['image-wrap--large']}>
        <img
          src={state.imageSrc}
          alt={filename}
          className={styles['image--large']}
          loading="lazy"
        />
        {isUploading && <LoadingProgressOverlay />}
      </div>
    );
  }

  return (
    <div className={styles['image-wrap']}>
      <TileImage src={state.imageSrc} alt={filename} className={styles.image} />
      {isUploading && <LoadingProgressOverlay />}
    </div>
  );
}

export function ImageErrorTile({ filename, onRetry }: { filename: string; onRetry: () => void }) {
  return (
    <Button
      type="button"
      variant="unstyled"
      onClick={onRetry}
      className={styles['image-error']}
      aria-label={`Retry loading ${filename}`}
      title={filename}
    >
      <RotateCw className={styles['error-icon']} />
      <span className={styles['error-name']}>{filename}</span>
      <span className={styles['error-action']}>Retry</span>
    </Button>
  );
}
