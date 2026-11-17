import { memo } from 'react';
import { X, Edit } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FileChip, TileImage } from '@/components/ui/attachment-viewer/AttachmentThumbnails';
import { isUploadedImageFile, isUploadedPdfFile, isUploadedXlsxFile } from '@/utils/fileTypes';
import styles from './FilePreviewList.module.scss';

interface FilePreviewItemProps {
  file: File;
  previewUrl: string;
  onRemove: () => void;
  onEdit?: () => void;
}

const FilePreviewItem = memo(function FilePreviewItem({
  file,
  previewUrl,
  onRemove,
  onEdit,
}: FilePreviewItemProps) {
  if (isUploadedImageFile(file)) {
    return (
      <div className={styles.item}>
        <TileImage src={previewUrl} alt={`Preview of ${file.name}`} className={styles.thumb} />
        <div className={styles.actions}>
          {onEdit && (
            <Button
              type="button"
              onClick={onEdit}
              variant="unstyled"
              className={styles['action-btn']}
              aria-label={`Edit ${file.name}`}
            >
              <Edit className={styles['action-icon']} />
            </Button>
          )}
          <Button
            type="button"
            onClick={onRemove}
            variant="unstyled"
            className={styles['action-btn']}
            aria-label={`Remove ${file.name}`}
          >
            <X className={styles['action-icon']} />
          </Button>
        </div>
      </div>
    );
  }

  const fileType = isUploadedPdfFile(file) ? 'pdf' : isUploadedXlsxFile(file) ? 'xlsx' : null;
  if (!fileType) return null;

  return (
    <FileChip
      filename={file.name}
      fileType={fileType}
      trailing={
        <Button
          type="button"
          onClick={onRemove}
          variant="unstyled"
          className={styles['chip-remove']}
          aria-label={`Remove ${file.name}`}
        >
          <X className={styles['action-icon']} />
        </Button>
      }
    />
  );
});

interface FilePreviewListProps {
  files: File[];
  previewUrls: string[];
  onRemoveFile: (index: number) => void;
  onEditImage?: (index: number) => void;
}

export const FilePreviewList = memo(function FilePreviewList({
  files,
  previewUrls,
  onRemoveFile,
  onEditImage,
}: FilePreviewListProps) {
  if (files.length === 0 || previewUrls.length === 0) {
    return null;
  }

  return (
    <div className={styles.list}>
      {files.map((file, index) => (
        <FilePreviewItem
          key={`${file.name}-${index}`}
          file={file}
          previewUrl={previewUrls[index]}
          onRemove={() => onRemoveFile(index)}
          onEdit={onEditImage && isUploadedImageFile(file) ? () => onEditImage(index) : undefined}
        />
      ))}
    </div>
  );
});
