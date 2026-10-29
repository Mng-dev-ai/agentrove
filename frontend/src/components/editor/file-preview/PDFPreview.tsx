import { memo, useLayoutEffect, useState } from 'react';
import { logger } from '@/utils/logger';
import { base64ToUint8Array } from '@/utils/base64';
import type { FileStructure } from '@/types/file-system.types';
import { PreviewContainer } from './PreviewContainer';
import { PreviewEmptyState } from './PreviewEmptyState';
import { getDisplayFileName, isValidBase64 } from './previewUtils';
import styles from './PDFPreview.module.scss';

export interface PDFPreviewProps {
  file: FileStructure;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const PDFPreview = memo(function PDFPreview({
  file,
  isFullscreen = false,
  onToggleFullscreen,
}: PDFPreviewProps) {
  const fileName = getDisplayFileName(file, 'document.pdf');
  const [iframeError, setIframeError] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useLayoutEffect(() => {
    let url: string | null = null;
    if (file.content && isValidBase64(file.content)) {
      try {
        const bytes = base64ToUint8Array(file.content);
        const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
        url = URL.createObjectURL(blob);
      } catch (err) {
        logger.error('PDF preview load failed', 'PDFPreview', err);
      }
    }

    setPdfUrl(url);
    setIframeError(false);

    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file.content]);

  if (!pdfUrl || iframeError) {
    return (
      <PreviewEmptyState
        fileName={fileName}
        message="Unable to load PDF"
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
      />
    );
  }

  return (
    <PreviewContainer
      fileName={fileName}
      isFullscreen={isFullscreen}
      onToggleFullscreen={onToggleFullscreen}
      contentClassName={styles.content}
    >
      <iframe
        src={pdfUrl}
        className={styles.iframe}
        title={fileName}
        onError={() => setIframeError(true)}
      />
    </PreviewContainer>
  );
});
