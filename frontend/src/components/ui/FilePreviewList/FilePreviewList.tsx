import { memo } from 'react';
import clsx from 'clsx';
import { X, FileText, FileSpreadsheet, Edit } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { isUploadedImageFile, isUploadedPdfFile, isUploadedXlsxFile } from '@/utils/fileTypes';
import styles from './FilePreviewList.module.scss';

interface FilePreviewItemProps {
  file: File;
  previewUrl: string;
  onRemove: () => void;
  onEdit?: () => void;
  compact?: boolean;
}

interface FileActionButtonsProps {
  onEdit?: () => void;
  onRemove: () => void;
  compact: boolean;
  editLabel?: string;
}

const FileActionButtons = ({
  onEdit,
  onRemove,
  compact,
  editLabel = 'Edit',
}: FileActionButtonsProps) => {
  const sizeModifier = compact ? 'compact' : 'full';
  return (
    <div className={styles.actions}>
      {onEdit && (
        <Button
          type="button"
          onClick={onEdit}
          variant="unstyled"
          className={clsx(styles['action-btn'], styles[`action-btn--${sizeModifier}`])}
          aria-label={editLabel}
        >
          <Edit className={clsx(styles['action-icon'], styles[`action-icon--${sizeModifier}`])} />
        </Button>
      )}
      <Button
        type="button"
        onClick={onRemove}
        variant="unstyled"
        className={clsx(styles['action-btn'], styles[`action-btn--${sizeModifier}`])}
        aria-label="Remove file"
      >
        <X className={clsx(styles['action-icon'], styles[`action-icon--${sizeModifier}`])} />
      </Button>
    </div>
  );
};

const FilePreviewItem = memo(function FilePreviewItem({
  file,
  previewUrl,
  onRemove,
  onEdit,
  compact = false,
}: FilePreviewItemProps) {
  const isImage = isUploadedImageFile(file);
  const isPdf = isUploadedPdfFile(file);
  const isXlsx = isUploadedXlsxFile(file);

  if (!isImage && !isPdf && !isXlsx) {
    return null;
  }

  const sizeModifier = compact ? 'compact' : 'full';

  return (
    <div className={clsx(styles.item, styles[`item--${sizeModifier}`])}>
      {isImage ? (
        <>
          <img
            src={previewUrl}
            alt={`Preview of ${file.name}`}
            className={clsx(styles.thumb, styles[`thumb--${sizeModifier}`])}
            loading="lazy"
          />
          <FileActionButtons
            onEdit={onEdit}
            onRemove={onRemove}
            compact={compact}
            editLabel="Edit image"
          />
        </>
      ) : isPdf ? (
        <>
          <div className={clsx(styles.placeholder, styles[`placeholder--${sizeModifier}`])}>
            <FileText
              className={clsx(
                styles['placeholder-icon'],
                styles['placeholder-icon--pdf'],
                styles[`placeholder-icon--${sizeModifier}`],
              )}
            />
            {!compact && <p className={styles['placeholder-name']}>{file.name}</p>}
            <div className={clsx(styles.badge, styles[`badge--${sizeModifier}`])}>
              <p className={clsx(styles['badge-text'], styles[`badge-text--${sizeModifier}`])}>
                {compact ? 'PDF' : 'PDF Document'}
              </p>
            </div>
          </div>
          <FileActionButtons
            onEdit={onEdit}
            onRemove={onRemove}
            compact={compact}
            editLabel="Edit PDF"
          />
        </>
      ) : isXlsx ? (
        <>
          <div
            className={clsx(
              styles.placeholder,
              styles[`placeholder--${sizeModifier}`],
              styles['placeholder--bordered'],
            )}
          >
            <FileSpreadsheet
              className={clsx(
                styles['placeholder-icon'],
                styles['placeholder-icon--xlsx'],
                styles[`placeholder-icon--${sizeModifier}`],
              )}
            />
            {!compact && <p className={styles['placeholder-name']}>{file.name}</p>}
            <div
              className={clsx(
                styles.badge,
                styles[`badge--${sizeModifier}`],
                styles['badge--success'],
              )}
            >
              <p
                className={clsx(
                  styles['badge-text'],
                  styles[`badge-text--${sizeModifier}`],
                  styles['badge-text--success'],
                )}
              >
                {compact ? 'Excel' : 'Excel Document'}
              </p>
            </div>
          </div>
          <FileActionButtons
            onEdit={onEdit}
            onRemove={onRemove}
            compact={compact}
            editLabel="Edit Excel"
          />
        </>
      ) : null}
    </div>
  );
});

interface FilePreviewListProps {
  files: File[];
  previewUrls: string[];
  onRemoveFile: (index: number) => void;
  onEditImage?: (index: number) => void;
  compact?: boolean;
}

export const FilePreviewList = memo(function FilePreviewList({
  files,
  previewUrls,
  onRemoveFile,
  onEditImage,
  compact = false,
}: FilePreviewListProps) {
  if (!files || files.length === 0 || !previewUrls || previewUrls.length === 0) {
    return null;
  }

  return (
    <div className={styles['file-preview-list']}>
      <div className={styles.list}>
        {files.map((file, index) => (
          <FilePreviewItem
            key={`${file.name}-${index}`}
            file={file}
            previewUrl={previewUrls[index]}
            onRemove={() => onRemoveFile(index)}
            onEdit={
              onEditImage && isUploadedImageFile(file)
                ? () => {
                    onEditImage(index);
                  }
                : undefined
            }
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
});
