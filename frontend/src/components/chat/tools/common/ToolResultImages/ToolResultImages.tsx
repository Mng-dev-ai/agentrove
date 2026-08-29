import { memo, useMemo, useState } from 'react';
import type { MessageAttachment } from '@/types/chat.types';
import { ImagePreviewModal } from '@/components/ui/ImagePreviewModal/ImagePreviewModal';
import styles from './ToolResultImages.module.scss';

interface ToolResultImagesProps {
  attachments: MessageAttachment[];
}

export const ToolResultImages = memo(function ToolResultImages({
  attachments,
}: ToolResultImagesProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const imageStates = useMemo(
    () =>
      Object.fromEntries(
        attachments.map((attachment) => [
          attachment.id,
          { isLoading: false, error: false, imageSrc: attachment.file_url },
        ]),
      ),
    [attachments],
  );

  const handleDownload = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <>
      <div className={styles.list}>
        {attachments.map((attachment, index) => (
          <button
            key={attachment.id}
            type="button"
            className={styles.button}
            onClick={() => setPreviewIndex(index)}
            aria-label={`Preview ${attachment.filename}`}
          >
            <img src={attachment.file_url} alt={attachment.filename} className={styles.image} />
          </button>
        ))}
      </div>
      <ImagePreviewModal
        isOpen={previewIndex !== null}
        onClose={() => setPreviewIndex(null)}
        attachments={attachments}
        imageStates={imageStates}
        currentIndex={previewIndex ?? 0}
        onIndexChange={setPreviewIndex}
        onDownload={handleDownload}
      />
    </>
  );
});
