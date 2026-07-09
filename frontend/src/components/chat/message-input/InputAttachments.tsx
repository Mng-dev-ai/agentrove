import { memo } from 'react';
import { FilePreviewList } from '@/components/ui/FilePreviewList/FilePreviewList';

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
    <div className="px-3 pb-1 pt-2">
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
