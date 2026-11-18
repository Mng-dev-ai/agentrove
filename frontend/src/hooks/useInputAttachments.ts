import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import { useFileHandling } from '@/hooks/useFileHandling';
import { useInputFileOperations } from '@/hooks/useInputFileOperations';
import { getCopiedAttachments } from '@/utils/copiedAttachments';

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
      const copied = getCopiedAttachments(event.clipboardData.getData('text/plain'));
      switch (copied?.status) {
        case 'ready':
          handleDroppedFiles(copied.files);
          break;
        case 'loading':
          event.preventDefault();
          toast('Attachments are still downloading, paste again in a moment');
          break;
        case 'failed':
          toast.error('Could not load the copied attachments');
          break;
      }
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
