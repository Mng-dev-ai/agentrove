import { useState, useEffect, useCallback, useLayoutEffect } from 'react';
import { logger } from '@/utils/logger';
import { isUploadedImageFile } from '@/utils/fileTypes';
import { filterChatAttachmentFiles } from '@/utils/file';
import { useUploadLimits } from '@/hooks/queries/useMachineQueries';

interface UseFileHandlingOptions {
  machineId: string;
  initialFiles?: File[] | null;
  onChange?: (files: File[]) => void;
}

export function useFileHandling({
  machineId,
  initialFiles = null,
  onChange,
}: UseFileHandlingOptions) {
  const uploadLimits = useUploadLimits(machineId);
  const [files, setFiles] = useState<File[]>(initialFiles ?? []);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  useEffect(() => {
    setFiles(initialFiles ?? []);
  }, [initialFiles]);

  useLayoutEffect(() => {
    const urls = files.map((file) => {
      if (isUploadedImageFile(file)) {
        try {
          const url = URL.createObjectURL(file);
          return url;
        } catch (error) {
          logger.error('Object URL creation failed', 'useFileHandling', error);
          return '';
        }
      }
      return '';
    });

    setPreviewUrls(urls);

    return () => {
      urls.forEach((url) => {
        if (url) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [files]);

  const addFiles = useCallback(
    (newFiles: File[]) => {
      const validFiles = filterChatAttachmentFiles(newFiles, uploadLimits);

      if (validFiles.length > 0) {
        setFiles((current) => {
          const updated = [...current, ...validFiles];
          onChange?.(updated);
          return updated;
        });
      }
      return validFiles.length;
    },
    [onChange, uploadLimits],
  );

  const setFileList = useCallback(
    (newFiles: File[]) => {
      const validFiles = filterChatAttachmentFiles(newFiles, uploadLimits);
      setFiles(validFiles);
      onChange?.(validFiles);
      return validFiles.length;
    },
    [onChange, uploadLimits],
  );

  const removeFile = useCallback(
    (index: number) => {
      setFiles((current) => {
        if (index >= 0 && index < current.length) {
          const updated = current.filter((_, i) => i !== index);
          onChange?.(updated);
          return updated;
        }
        return current;
      });
    },
    [onChange],
  );

  const clearFiles = useCallback(() => {
    setFiles([]);
    onChange?.([]);
  }, [onChange]);

  const replaceFile = useCallback(
    (index: number, newFile: File) => {
      const [validFile] = filterChatAttachmentFiles([newFile], uploadLimits);
      if (!validFile) {
        return;
      }
      setFiles((current) => {
        if (index >= 0 && index < current.length) {
          const updated = [...current];
          updated[index] = validFile;
          onChange?.(updated);
          return updated;
        }
        return current;
      });
    },
    [onChange, uploadLimits],
  );

  return {
    files,
    previewUrls,
    addFiles,
    setFileList,
    removeFile,
    clearFiles,
    replaceFile,
  };
}
