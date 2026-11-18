import { useCallback } from 'react';
import { loadCopiedAttachmentFiles } from '@/hooks/useClipboard';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import { useFileHandling } from '@/hooks/useFileHandling';
import { useInputFileOperations } from '@/hooks/useInputFileOperations';
import { logger } from '@/utils/logger';

interface UseInputAttachmentsOptions {
  attachedFiles: File[] | null;
  onAttach?: (files: File[]) => void;
}

export function useInputAttachments({ attachedFiles, onAttach }: UseInputAttachmentsOptions) {
  const { previewUrls } = useFileHandling({
    initialFiles: attachedFiles,
  });

  const {
    showFileUpload,
    setShowFileUpload,
    showDrawingModal,
    editingImageIndex,
    handleFileSelect,
    handleRemoveFile,
    handleDrawClick,
    handleDrawingSave,
    handleDroppedFiles,
    closeDrawingModal,
  } = useInputFileOperations({
    attachedFiles,
    onAttach,
  });

  const { isDragging, dragHandlers, resetDragState } = useDragAndDrop({
    onFilesDrop: handleDroppedFiles,
  });

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      // Pasted screenshots/files arrive as clipboard files — route them through the
      // same validated attach path as drag-and-drop instead of losing them.
      if (!onAttach) return;
      const files = Array.from(event.clipboardData.files);
      if (files.length > 0) {
        event.preventDefault();
        handleDroppedFiles(files);
        return;
      }
      loadCopiedAttachmentFiles(event.clipboardData.getData('text/plain'))
        ?.then(handleDroppedFiles)
        .catch((error) =>
          logger.error('Copied attachments paste failed', 'useInputAttachments', error),
        );
    },
    [onAttach, handleDroppedFiles],
  );

  return {
    previewUrls,
    showFileUpload,
    setShowFileUpload,
    showDrawingModal,
    editingImageIndex,
    handleFileSelect,
    handleRemoveFile,
    handleDrawClick,
    handleDrawingSave,
    closeDrawingModal,
    isDragging,
    dragHandlers,
    resetDragState,
    handlePaste,
  };
}
