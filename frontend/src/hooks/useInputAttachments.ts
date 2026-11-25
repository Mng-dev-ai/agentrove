import { useCallback, useLayoutEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useDragAndDrop } from '@/hooks/useDragAndDrop';
import { useFileHandling } from '@/hooks/useFileHandling';
import { useInputFileOperations } from '@/hooks/useInputFileOperations';
import { getCopiedAttachments } from '@/utils/copiedAttachments';

interface UseInputAttachmentsOptions {
  machineId: string;
  attachedFiles: File[] | null;
  onAttach?: (files: File[]) => void;
}

export function useInputAttachments({
  machineId,
  attachedFiles,
  onAttach,
}: UseInputAttachmentsOptions) {
  const { previewUrls } = useFileHandling({
    machineId,
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
    machineId,
    attachedFiles,
    onAttach,
  });

  const { isDragging, dragHandlers, resetDragState } = useDragAndDrop({
    onFilesDrop: handleDroppedFiles,
  });

  const handleDroppedFilesRef = useRef(handleDroppedFiles);
  useLayoutEffect(() => {
    handleDroppedFilesRef.current = handleDroppedFiles;
  }, [handleDroppedFiles]);

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
      const pastedText = event.clipboardData.getData('text/plain');
      const copiedFiles = getCopiedAttachments(pastedText);
      if (!copiedFiles) return;
      event.preventDefault();
      const textarea = event.currentTarget;
      void toast
        .promise(copiedFiles, {
          loading: 'Loading copied attachments…',
          error: 'Could not load the copied attachments',
        })
        .catch(() => [])
        .then((files) => {
          if (!textarea.isConnected) return;
          handleDroppedFilesRef.current(files);
          textarea.focus();
          document.execCommand('insertText', false, pastedText);
        });
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
