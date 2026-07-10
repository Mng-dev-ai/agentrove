import { memo } from 'react';
import { FilePreviewList } from '@/components/ui/FilePreviewList/FilePreviewList';
import styles from './InputAttachments.module.scss';

interface InputAttachmentsProps {
  files: File[];
  previewUrls: string[];
  onRemoveFile: (index: number) => void;
  onEditImage: (index: number) => void;
}

export const InputAttachments = memo(function InputAttachments({
  files,
  previewUrls,
  onRemoveFile,
  onEditImage,
}: InputAttachmentsProps) {
  if (files.length === 0) return null;

  return (
    <div className={styles['input-attachments']}>
      <FilePreviewList
        files={files}
        previewUrls={previewUrls}
        onRemoveFile={onRemoveFile}
        onEditImage={onEditImage}
        compact={true}
      />
    </div>
  );
});
