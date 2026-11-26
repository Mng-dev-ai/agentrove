import { useState, useCallback, type Dispatch, type SetStateAction } from 'react';
import { logger } from '@/utils/logger';
import { convertDataUrlToUploadedFile, filterChatAttachmentFiles } from '@/utils/file';
import { useUploadLimits } from '@/hooks/queries/useMachineQueries';

interface UseInputFileOperationsProps {
  machineId: string;
  attachedFiles?: File[] | null;
  onAttach?: Dispatch<SetStateAction<File[]>>;
}

export const useInputFileOperations = ({
  machineId,
  attachedFiles,
  onAttach,
}: UseInputFileOperationsProps) => {
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [showDrawingModal, setShowDrawingModal] = useState(false);
  const [editingImageIndex, setEditingImageIndex] = useState<number | null>(null);

  const uploadLimits = useUploadLimits(machineId);
  const filterValidFiles = useCallback(
    (files: File[]) => filterChatAttachmentFiles(files, uploadLimits),
    [uploadLimits],
  );

  const handleFileSelect = useCallback(
    (files: File[]) => {
      if (onAttach) {
        const validFiles = filterValidFiles(files);
        if (validFiles.length > 0) {
          onAttach((current) => [...current, ...validFiles]);
        }
      }
      setShowFileUpload(false);
    },
    [filterValidFiles, onAttach],
  );

  const handleRemoveFile = useCallback(
    (index: number) => {
      onAttach?.((current) => current.filter((_, fileIndex) => fileIndex !== index));
    },
    [onAttach],
  );

  const handleDrawClick = useCallback((index: number) => {
    setEditingImageIndex(index);
    setShowDrawingModal(true);
  }, []);

  const handleDrawingSave = useCallback(
    async (dataUrl: string) => {
      if (editingImageIndex === null || !attachedFiles) return;

      const originalFile = attachedFiles[editingImageIndex];
      if (!originalFile) {
        setShowDrawingModal(false);
        setEditingImageIndex(null);
        return;
      }

      try {
        const file = await convertDataUrlToUploadedFile(
          dataUrl,
          originalFile.name || 'edited-image.png',
        );

        const [validFile] = filterValidFiles([file]);
        if (onAttach && validFile) {
          onAttach((current) => current.map((f) => (f === originalFile ? validFile : f)));
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
        onAttach((current) => [...current, ...validFiles]);
      }
    },
    [filterValidFiles, onAttach],
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
