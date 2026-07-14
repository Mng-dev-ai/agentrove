import { useState, useEffect, useCallback, useMemo } from 'react';
import { logger } from '@/utils/logger';
import { isUploadedImageFile } from '@/utils/fileTypes';
import { filterChatAttachmentFiles } from '@/utils/file';

interface UseFileHandlingOptions {
  initialFiles?: File[] | null;
  onChange?: (files: File[]) => void;
}

export function useFileHandling({ initialFiles = null, onChange }: UseFileHandlingOptions = {}) {
  const [files, setFiles] = useState<File[]>(initialFiles ?? []);

  useEffect(() => {
    setFiles(initialFiles ?? []);
  }, [initialFiles]);

  const previewUrls = useMemo(() => {
    if (files.length === 0) {
      return [];
    }

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

    return urls;
  }, [files]);

  useEffect(() => {
    const currentUrls = previewUrls.filter((url) => url !== '');

    return () => {
      currentUrls.forEach((url) => {
        if (url) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [previewUrls]);

  const addFiles = useCallback(
    (newFiles: File[]) => {
      const validFiles = filterChatAttachmentFiles(newFiles);

      if (validFiles.length > 0) {
        setFiles((current) => {
          const updated = [...current, ...validFiles];
          onChange?.(updated);
          return updated;
        });
      }
      return validFiles.length;
    },
    [onChange],
  );

  const setFileList = useCallback(
    (newFiles: File[]) => {
      const validFiles = filterChatAttachmentFiles(newFiles);
      setFiles(validFiles);
      onChange?.(validFiles);
      return validFiles.length;
    },
    [onChange],
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
      const [validFile] = filterChatAttachmentFiles([newFile]);
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
    [onChange],
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
