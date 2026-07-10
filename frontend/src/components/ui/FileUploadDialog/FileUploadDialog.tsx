import { memo } from 'react';
import { Plus, Image, FileText, FileSpreadsheet, FileUp } from 'lucide-react';
import clsx from 'clsx';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import { useFileHandling } from '@/hooks/useFileHandling';
import { FilePreviewList } from '@/components/ui/FilePreviewList/FilePreviewList';
import { BaseModal } from '@/components/ui/shared/BaseModal/BaseModal';
import { ModalHeader } from '@/components/ui/shared/ModalHeader/ModalHeader';
import { Button } from '@/components/ui/primitives/Button/Button';
import { Input } from '@/components/ui/primitives/Input/Input';
import styles from './FileUploadDialog.module.scss';

interface FileUploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onFileSelect: (files: File[]) => void;
}

export const FileUploadDialog = memo(function FileUploadDialog({
  isOpen,
  onClose,
  onFileSelect,
}: FileUploadDialogProps) {
  const { files, previewUrls, addFiles, removeFile, clearFiles } = useFileHandling({});

  const { isDragging, dragHandlers } = useDragAndDrop({
    onFilesDrop: (droppedFiles) => addFiles(droppedFiles),
  });

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const fileList = Array.from(e.target.files);
      addFiles(fileList);
    }
    e.currentTarget.value = '';
  };

  const handleUpload = () => {
    if (files.length > 0) {
      onFileSelect(files);
      onClose();
      clearFiles();
    }
  };

  if (!isOpen) return null;

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="md" className={styles.container}>
      <ModalHeader title="Upload Files" onClose={onClose} />
      <div className={styles.content}>
        <div
          {...dragHandlers}
          className={clsx(styles.dropzone, isDragging && styles['dropzone--dragging'])}
        >
          {files.length > 0 ? (
            <div className={styles.stack}>
              <div className={styles.grid}>
                <FilePreviewList
                  files={files}
                  previewUrls={previewUrls}
                  onRemoveFile={removeFile}
                  compact={true}
                />
                <label className={styles['add-more']}>
                  <Plus className={styles['add-more-icon']} />
                  <span className={styles['add-more-label']}>Add more</span>
                  <Input
                    type="file"
                    accept="image/*,application/pdf,.xlsx"
                    multiple
                    onChange={handleFileInput}
                    variant="unstyled"
                    className={styles['hidden-input']}
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className={styles.stack}>
              <div className={styles['empty-icons']}>
                <div className={styles['empty-icon-circle']}>
                  <Image className={styles['empty-icon']} />
                </div>
                <div className={styles['empty-icon-circle']}>
                  <FileText className={styles['empty-icon']} />
                </div>
                <div className={styles['empty-icon-circle']}>
                  <FileSpreadsheet className={styles['empty-icon']} />
                </div>
              </div>
              <div>
                <p className={styles['empty-hint']}>
                  Drag and drop your files here, or{' '}
                  <label className={styles.browse}>
                    browse
                    <Input
                      type="file"
                      accept="image/*,application/pdf,.xlsx"
                      multiple
                      onChange={handleFileInput}
                      variant="unstyled"
                      className={styles['hidden-input']}
                    />
                  </label>
                </p>
                <p className={styles['empty-formats']}>
                  Supported formats: PNG, JPEG, GIF, PDF, XLSX
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={styles.footer}>
        <div className={styles['footer-actions']}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className={styles['cancel-button']}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleUpload}
            disabled={files.length === 0}
            className={styles['upload-button']}
          >
            <FileUp className={styles['upload-icon']} />
            Upload {files.length > 0 && `(${files.length})`}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
});
