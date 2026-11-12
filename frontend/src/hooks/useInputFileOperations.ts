import { useState, useCallback } from 'react';
import { logger } from '@/utils/logger';
import { convertDataUrlToUploadedFile, filterChatAttachmentFiles } from '@/utils/file';

interface UseInputFileOperationsProps {
  attachedFiles?: File[] | null;
  onAttach?: (files: File[]) => void;
}

export const useInputFileOperations = ({
  attachedFiles,
  onAttach,
}: UseInputFileOperationsProps) => {
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [showDrawingModal, setShowDrawingModal] = useState(false);
  const [editingImageIndex, setEditingImageIndex] = useState<number | null>(null);

  const filterValidFiles = useCallback((files: File[]) => filterChatAttachmentFiles(files), []);

  const handleFileSelect = useCallback(
    (files: File[]) => {
      if (onAttach) {
        const validFiles = filterValidFiles(files);
        if (validFiles.length > 0) {
          onAttach([...(attachedFiles || []), ...validFiles]);
        }
      }
      setShowFileUpload(false);
    },
    [filterValidFiles, onAttach, attachedFiles],
  );

  const handleRemoveFile = useCallback(
    (index: number) => {
      if (onAttach && attachedFiles) {
        const newFiles = [...attachedFiles];
        newFiles.splice(index, 1);
        onAttach(newFiles);
      }
    },
    [onAttach, attachedFiles],
  );

  const handleDrawClick = useCallback((index: number) => {
    setEditingImageIndex(index);
    setShowDrawingModal(true);
  }, []);

  const handleDrawingSave = useCallback(
    async (dataUrl: string) => {
      if (editingImageIndex === null || !attachedFiles) return;

      if (editingImageIndex >= attachedFiles.length) {
        setShowDrawingModal(false);
        setEditingImageIndex(null);
        return;
      }

      try {
        const originalFile = attachedFiles[editingImageIndex];
        const file = await convertDataUrlToUploadedFile(
          dataUrl,
          originalFile?.name || 'edited-image.png',
        );

        const [validFile] = filterValidFiles([file]);
        if (onAttach && validFile) {
          const newFiles = [...attachedFiles];
          newFiles[editingImageIndex] = validFile;
          onAttach(newFiles);
        }
      } catch (error) {
        logger.error('Drawing save failed', 'useInputFileOperations', error);
      } finally {
        setShowDrawingModal(false);
        setEditingImageIndex(null);
      }
    },
    [editingImageIndex, attachedFiles, onAttach, filterValidFiles],
  );

  const handleDroppedFiles = useCallback(
    (droppedFiles: File[]) => {
      if (!onAttach) return;

      const validFiles = filterValidFiles(droppedFiles);

      if (validFiles.length > 0) {
        const existingFiles = attachedFiles || [];
        onAttach([...existingFiles, ...validFiles]);
      }
    },
    [filterValidFiles, onAttach, attachedFiles],
  );

  const closeDrawingModal = useCallback(() => {
    setShowDrawingModal(false);
    setEditingImageIndex(null);
  }, []);

  return {
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
  };
};
