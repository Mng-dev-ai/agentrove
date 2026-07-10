import { useCallback } from 'react';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import { useFileHandling } from '@/hooks/useFileHandling';
import { useInputFileOperations } from '@/hooks/useInputFileOperations';

interface UseInputAttachmentsOptions {
  attachedFiles: File[] | null;
  onAttach?: (files: File[]) => void;
}

// File preview URLs, attach/remove/draw operations, drag-and-drop, and paste —
// everything that turns dropped/pasted/selected files into chat attachments.
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
      const files = Array.from(event.clipboardData.files);
      if (!onAttach || files.length === 0) return;
      event.preventDefault();
      handleDroppedFiles(files);
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
