import { memo } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import { FileText, FileSpreadsheet, Download } from 'lucide-react';
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

interface IconConfig {
  icon: LucideIcon;
  tone: 'pdf' | 'xlsx' | 'file';
  label: string;
}

const getFileExtension = (filename?: string): string => {
  return filename?.split('.').pop()?.toUpperCase() || '';
};

const getIconConfig = (fileType: string, filename?: string): IconConfig => {
  if (fileType === 'pdf') {
    return { icon: FileText, tone: 'pdf', label: 'PDF' };
  }

  if (fileType === 'xlsx') {
    return { icon: FileSpreadsheet, tone: 'xlsx', label: getFileExtension(filename) || 'XLSX' };
  }

  return { icon: FileText, tone: 'file', label: 'FILE' };
};

const LoadingProgressOverlay = memo(function LoadingProgressOverlay() {
  return (
    <div className={styles.overlay}>
      <div className={styles['overlay-center']}>
        <Spinner size="xs" className={styles['spinner-white']} />
      </div>
    </div>
  );
});

interface ThumbnailWrapperProps {
  attachment: MessageAttachment;
  onDownload: (url: string, filename: string) => void;
  onPreview?: () => void;
  children: ReactNode;
}

export function ThumbnailWrapper({
  attachment,
  onDownload,
  onPreview,
  children,
}: ThumbnailWrapperProps) {
  const filename = attachment.filename || getDefaultFilename(attachment.file_type, 0);
  const isInteractive = Boolean(onPreview);

  return (
    <div
      className={clsx(styles.thumbnail, isInteractive && styles['thumbnail--interactive'])}
      onClick={onPreview}
      onKeyDown={
        isInteractive
          ? (e) => {
              // Only react to keys on the wrapper itself — avoid double-firing when the nested
              // download button is focused and the user presses Enter/Space on it.
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
            // Stop propagation so the wrapper's preview click handler (images) doesn't fire.
            e.stopPropagation();
            onDownload(attachment.file_url, filename);
          }}
          className={styles['download-button']}
          aria-label={`Download ${attachment.file_type}`}
        >
          <Download className={styles['download-icon']} />
        </Button>
      </div>
    </div>
  );
}

export function IconThumbnail({
  attachment,
  isLoading = false,
}: {
  attachment: MessageAttachment;
  isLoading?: boolean;
}) {
  const { icon: Icon, tone, label } = getIconConfig(attachment.file_type, attachment.filename);

  return (
    <div className={styles['icon-thumbnail']}>
      <Icon className={clsx(styles.icon, styles[`icon--${tone}`])} />
      <p className={styles['icon-label']}>{label}</p>
      {isLoading && <LoadingProgressOverlay />}
    </div>
  );
}

export function ImageThumbnail({
  attachment,
  state,
  index,
  isUploading = false,
}: {
  attachment: MessageAttachment;
  state: ImageState;
  index: number;
  isUploading?: boolean;
}) {
  const filename = attachment.filename || getDefaultFilename('image', index);

  if (state.isLoading) {
    return (
      <div className={styles['image-loading']}>
        <LoadingProgressOverlay />
      </div>
    );
  }

  if (state.error) {
    return (
      <div className={styles['image-error']}>
        <p className={styles['error-label']}>Error</p>
      </div>
    );
  }

  if (state.imageSrc) {
    return (
      <div className={styles['image-wrap']}>
        <img src={state.imageSrc} alt={filename} className={styles.image} loading="lazy" />
        {isUploading && <LoadingProgressOverlay />}
      </div>
    );
  }

  return null;
}
