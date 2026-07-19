import { useState, useCallback, useRef, useMemo } from 'react';

interface UseDragAndDropOptions {
  onFilesDrop?: (files: File[]) => void;
  disabled?: boolean;
}

export function useDragAndDrop({ onFilesDrop, disabled = false }: UseDragAndDropOptions = {}) {
  const [isDragging, setIsDragging] = useState(false);
  // enter/leave fire per descendant — counter avoids flicker; reset only at 0.
  const dragCounter = useRef(0);

  const handleDragIn = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;

      dragCounter.current++;
      setIsDragging(true);
    },
    [disabled],
  );

  const handleDragOut = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;

      setIsDragging(true);
    },
    [disabled],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;

      setIsDragging(false);
      dragCounter.current = 0;

      const files = e.dataTransfer.files;
      if (files?.length > 0 && onFilesDrop) {
        const fileArray: File[] = Array.from(files);
        onFilesDrop(fileArray);
      }
    },
    [disabled, onFilesDrop],
  );

  const resetDragState = useCallback(() => {
    setIsDragging(false);
    dragCounter.current = 0;
  }, []);

  const dragHandlers = useMemo(
    () => ({
      onDragEnter: handleDragIn,
      onDragLeave: handleDragOut,
      onDragOver: handleDragOver,
      onDrop: handleDrop,
    }),
    [handleDragIn, handleDragOut, handleDragOver, handleDrop],
  );

  return {
    isDragging,
    dragHandlers,
    resetDragState,
  };
}
