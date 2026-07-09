import { memo } from 'react';
import { Plus, Image, FileText, FileSpreadsheet, FileUp } from 'lucide-react';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import { useFileHandling } from '@/hooks/useFileHandling';
import { FilePreviewList } from './FilePreviewList';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader } from './shared/ModalHeader';
import { cancelButtonClass } from './shared/modalConstants';
import { Button } from './primitives/Button/Button';
import { Input } from './primitives/Input/Input';

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
    <BaseModal isOpen={isOpen} onClose={onClose} size="md" className="flex max-h-[90vh] flex-col">
      <ModalHeader title="Upload Files" onClose={onClose} />
      <div className="flex-1 space-y-4 overflow-auto p-4">
        <div
          {...dragHandlers}
          className={`relative rounded-xl border-2 border-dashed p-4 text-center transition-colors duration-200 ${
            isDragging
              ? 'border-border bg-surface-secondary dark:border-border-dark dark:bg-surface-dark-secondary'
              : 'border-border dark:border-border-dark'
          }`}
        >
          {files.length > 0 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <FilePreviewList
                  files={files}
                  previewUrls={previewUrls}
                  onRemoveFile={removeFile}
                  compact={true}
                />
                <label className="flex h-24 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border transition-colors duration-200 hover:border-border-hover hover:bg-surface-hover dark:border-border-dark dark:hover:border-border-dark-hover dark:hover:bg-surface-dark-hover">
                  <Plus className="mb-1 h-6 w-6 text-text-tertiary dark:text-text-dark-tertiary" />
                  <span className="text-xs text-text-secondary dark:text-text-dark-secondary">
                    Add more
                  </span>
                  <Input
                    type="file"
                    accept="image/*,application/pdf,.xlsx"
                    multiple
                    onChange={handleFileInput}
                    variant="unstyled"
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-secondary dark:bg-surface-dark-secondary">
                  <Image className="h-5 w-5 text-text-tertiary dark:text-text-dark-tertiary" />
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-secondary dark:bg-surface-dark-secondary">
                  <FileText className="h-5 w-5 text-text-tertiary dark:text-text-dark-tertiary" />
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-secondary dark:bg-surface-dark-secondary">
                  <FileSpreadsheet className="h-5 w-5 text-text-tertiary dark:text-text-dark-tertiary" />
                </div>
              </div>
              <div>
                <p className="text-xs text-text-secondary dark:text-text-dark-secondary">
                  Drag and drop your files here, or{' '}
                  <label className="cursor-pointer text-text-primary underline-offset-2 transition-colors duration-200 hover:underline dark:text-text-dark-primary">
                    browse
                    <Input
                      type="file"
                      accept="image/*,application/pdf,.xlsx"
                      multiple
                      onChange={handleFileInput}
                      variant="unstyled"
                      className="hidden"
                    />
                  </label>
                </p>
                <p className="mt-2 text-xs text-text-tertiary dark:text-text-dark-tertiary">
                  Supported formats: PNG, JPEG, GIF, PDF, XLSX
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border p-3 dark:border-border-dark">
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className={cancelButtonClass}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleUpload}
            disabled={files.length === 0}
            className="flex items-center gap-2 border-text-primary bg-text-primary text-surface hover:bg-text-secondary dark:border-text-dark-primary dark:bg-text-dark-primary dark:text-surface-dark dark:hover:bg-text-dark-secondary"
          >
            <FileUp className="h-3.5 w-3.5" />
            Upload {files.length > 0 && `(${files.length})`}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
});
