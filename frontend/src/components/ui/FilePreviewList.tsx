import { memo } from 'react';
import { X, FileText, FileSpreadsheet, Edit } from 'lucide-react';
import { Button } from './primitives/Button/Button';
import { isUploadedImageFile, isUploadedPdfFile, isUploadedXlsxFile } from '@/utils/fileTypes';

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
  buttonSize: string;
  iconSize: string;
  editLabel?: string;
}

const FileActionButtons = ({
  onEdit,
  onRemove,
  buttonSize,
  iconSize,
  editLabel = 'Edit',
}: FileActionButtonsProps) => (
  <div className="absolute right-0 top-0 m-1 flex gap-1">
    {onEdit && (
      <Button
        type="button"
        onClick={onEdit}
        variant="unstyled"
        className={`${buttonSize} rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100`}
        aria-label={editLabel}
      >
        <Edit className={iconSize} />
      </Button>
    )}
    <Button
      type="button"
      onClick={onRemove}
      variant="unstyled"
      className={`${buttonSize} rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100`}
      aria-label="Remove file"
    >
      <X className={iconSize} />
    </Button>
  </div>
);

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

  const previewSize = compact ? 'h-14 w-14' : 'h-48 w-48';
  const containerSize = compact ? 'h-14 w-14' : 'h-48 w-48';
  const buttonSize = compact ? 'p-1' : 'p-1.5';
  const iconSize = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';

  return (
    <div className={`group relative ${containerSize}`}>
      {isImage ? (
        <>
          <img
            src={previewUrl}
            alt={`Preview of ${file.name}`}
            className={`${previewSize} block rounded-lg object-cover`}
            loading="lazy"
          />
          <FileActionButtons
            onEdit={onEdit}
            onRemove={onRemove}
            buttonSize={buttonSize}
            iconSize={iconSize}
            editLabel="Edit image"
          />
        </>
      ) : isPdf ? (
        <>
          <div
            className={`${previewSize} flex flex-col items-center justify-center rounded-lg bg-surface-secondary dark:bg-surface-dark-secondary`}
          >
            <FileText
              className={
                compact
                  ? 'mb-1 h-6 w-6 text-error-500 dark:text-error-400'
                  : 'mb-3 h-14 w-14 text-error-500 dark:text-error-400'
              }
            />
            {!compact && (
              <p className="max-w-full truncate px-4 text-center text-sm text-text-secondary dark:text-text-dark-secondary">
                {file.name}
              </p>
            )}
            <div
              className={`${compact ? 'mt-1' : 'mt-2'} bg-surface-active dark:bg-surface-dark-active ${compact ? 'px-2 py-0.5' : 'px-3 py-1'} rounded-full`}
            >
              <p
                className={
                  compact
                    ? 'text-2xs text-text-secondary dark:text-text-dark-secondary'
                    : 'text-xs text-text-secondary dark:text-text-dark-secondary'
                }
              >
                {compact ? 'PDF' : 'PDF Document'}
              </p>
            </div>
          </div>
          <FileActionButtons
            onEdit={onEdit}
            onRemove={onRemove}
            buttonSize={buttonSize}
            iconSize={iconSize}
            editLabel="Edit PDF"
          />
        </>
      ) : isXlsx ? (
        <>
          <div
            className={`${previewSize} flex flex-col items-center justify-center rounded-lg border border-border bg-surface-secondary dark:border-border-dark dark:bg-surface-dark-secondary`}
          >
            <FileSpreadsheet
              className={
                compact
                  ? 'mb-1 h-6 w-6 text-success-600 dark:text-success-400'
                  : 'mb-3 h-14 w-14 text-success-600 dark:text-success-400'
              }
            />
            {!compact && (
              <p className="max-w-full truncate px-4 text-center text-sm text-text-secondary dark:text-text-dark-secondary">
                {file.name}
              </p>
            )}
            <div
              className={`${compact ? 'mt-1' : 'mt-2'} bg-success-100 dark:bg-success-900/30 ${compact ? 'px-2 py-0.5' : 'px-3 py-1'} rounded-full`}
            >
              <p
                className={
                  compact
                    ? 'text-2xs text-success-700 dark:text-success-400'
                    : 'text-xs text-success-700 dark:text-success-400'
                }
              >
                {compact ? 'Excel' : 'Excel Document'}
              </p>
            </div>
          </div>
          <FileActionButtons
            onEdit={onEdit}
            onRemove={onRemove}
            buttonSize={buttonSize}
            iconSize={iconSize}
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
    <div className="relative">
      <div className="flex flex-wrap items-start gap-3">
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
