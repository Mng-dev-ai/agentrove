import { memo, useEffect, useRef, useState, useCallback } from 'react';
import clsx from 'clsx';
import { logger } from '@/utils/logger';
import { BaseModal } from '../shared/BaseModal/BaseModal';
import { ModalHeader } from '../shared/ModalHeader/ModalHeader';
import { DrawingToolbar } from './DrawingToolbar';
import styles from './DrawingModal.module.scss';

interface CanvasCoordinates {
  x: number;
  y: number;
}

interface DrawingModalProps {
  imageUrl: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}

export const DrawingModal = memo(function DrawingModal({
  imageUrl,
  isOpen,
  onClose,
  onSave,
}: DrawingModalProps) {
  const [color, setColor] = useState('#FF0000');
  const [brushSize, setBrushSize] = useState(5);
  const [canvasReady, setCanvasReady] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<CanvasCoordinates>({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (!ctx) {
      return;
    }

    contextRef.current = ctx;

    let cancelled = false;
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;

      ctx.drawImage(img, 0, 0);

      imageRef.current = img;
      setCanvasReady(true);
    };

    img.onerror = () => {
      setCanvasReady(false);
    };

    // WKWebView (Tauri desktop) taints the canvas when an image loads from a
    // blob: URL, making toDataURL throw on save — convert to a data URL first.
    fetch(imageUrl)
      .then((res) => res.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          }),
      )
      .then((dataUrl) => {
        if (!cancelled) img.src = dataUrl;
      })
      .catch(() => {
        if (!cancelled) setCanvasReady(false);
      });

    return () => {
      cancelled = true;
      if (imageRef.current) {
        imageRef.current.src = '';
        imageRef.current = null;
      }
      contextRef.current = null;
    };
  }, [imageUrl]);

  const getCanvasCoordinates = useCallback(
    (e: React.MouseEvent | React.TouchEvent): CanvasCoordinates => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      let clientX: number;
      let clientY: number;

      if ('touches' in e) {
        const touch = e.touches[0] || e.changedTouches[0];
        clientX = touch.clientX;
        clientY = touch.clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    },
    [],
  );

  const startDrawing = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      isDrawingRef.current = true;
      lastPosRef.current = getCanvasCoordinates(e);
    },
    [getCanvasCoordinates],
  );

  const draw = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      if (!isDrawingRef.current || !contextRef.current) return;

      const currentPos = getCanvasCoordinates(e);

      contextRef.current.beginPath();
      contextRef.current.strokeStyle = color;
      contextRef.current.lineWidth = brushSize;
      contextRef.current.lineCap = 'round';
      contextRef.current.lineJoin = 'round';
      contextRef.current.moveTo(lastPosRef.current.x, lastPosRef.current.y);
      contextRef.current.lineTo(currentPos.x, currentPos.y);
      contextRef.current.stroke();

      lastPosRef.current = currentPos;
    },
    [getCanvasCoordinates, color, brushSize],
  );

  const stopDrawing = useCallback(() => {
    isDrawingRef.current = false;
  }, []);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => startDrawing(e);
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => draw(e);
  const handleMouseUp = () => stopDrawing();

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => startDrawing(e);
  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => draw(e);
  const handleTouchEnd = () => stopDrawing();

  const handleReset = useCallback(() => {
    if (!contextRef.current || !imageRef.current || !canvasRef.current) return;

    contextRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    contextRef.current.drawImage(imageRef.current, 0, 0);
  }, []);

  const getImageData = useCallback((): string => {
    if (!canvasRef.current) return '';
    return canvasRef.current.toDataURL('image/png');
  }, []);

  const getCanvasStyle = useCallback(() => {
    if (!imageRef.current) return { width: '100%', height: 'auto' };

    const img = imageRef.current;
    const aspectRatio = img.width / img.height;

    return {
      width: '100%',
      height: 'auto',
      aspectRatio: `${aspectRatio}`,
      maxHeight: '70vh',
      ...(CSS.supports &&
        !CSS.supports('aspect-ratio', '1') && {
          paddingBottom: `${(1 / aspectRatio) * 100}%`,
          position: 'relative' as const,
        }),
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleSave = () => {
    try {
      const dataUrl = getImageData();
      if (dataUrl) {
        onSave(dataUrl);
      }
    } catch (error) {
      logger.error('Canvas data URL conversion failed', 'DrawingModal', error);
    }
  };

  if (!isOpen) return null;

  const colors = [
    '#FF0000',
    '#00FF00',
    '#0000FF',
    '#FFFF00',
    '#FF00FF',
    '#00FFFF',
    '#000000',
    '#FFFFFF',
  ];

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="4xl">
      <ModalHeader title="Edit Image" onClose={onClose} />

      <div className={styles.body}>
        <div className={styles['canvas-wrap']}>
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className={clsx(styles.canvas, !canvasReady && styles['canvas--hidden'])}
            style={{ touchAction: 'none', ...getCanvasStyle() }}
            aria-label="Drawing canvas"
          />
          {!canvasReady && (
            <div className={styles['loading-overlay']}>
              <p className={styles['loading-text']}>Loading image...</p>
            </div>
          )}
        </div>
      </div>

      <DrawingToolbar
        colors={colors}
        color={color}
        onColorSelect={setColor}
        brushSize={brushSize}
        onBrushSizeChange={setBrushSize}
        onReset={handleReset}
        onSave={handleSave}
        canvasReady={canvasReady}
      />
    </BaseModal>
  );
});
