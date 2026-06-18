import { memo, useEffect, useRef, useState, useCallback } from 'react';
import { logger } from '@/utils/logger';
import { Check, Pencil, RotateCcw } from 'lucide-react';
import { BaseModal } from './shared/BaseModal';
import { ModalHeader } from './shared/ModalHeader';
import { Button } from './primitives/Button';
import { Input } from './primitives/Input';

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

      <div className="p-4">
        <div className="relative flex w-full justify-center">
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className={`w-full cursor-crosshair rounded-lg border border-border dark:border-border-dark ${!canvasReady ? 'opacity-0' : ''}`}
            style={{ touchAction: 'none', ...getCanvasStyle() }}
            aria-label="Drawing canvas"
          />
          {!canvasReady && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg border border-border bg-surface dark:border-border-dark dark:bg-surface-dark">
              <p className="text-text-tertiary dark:text-text-dark-tertiary">Loading image...</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border p-4 dark:border-border-dark">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            {colors.map((c) => (
              <Button
                key={c}
                onClick={() => setColor(c)}
                variant="unstyled"
                className={`h-6 w-6 rounded-full border ${
                  color === c
                    ? 'ring-2 ring-text-primary dark:ring-text-dark-primary'
                    : 'ring-1 ring-border dark:ring-border-dark'
                }`}
                style={{ backgroundColor: c }}
                aria-label={`Select color ${c}`}
                aria-pressed={color === c}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            <Input
              type="range"
              min="1"
              max="20"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-24"
              variant="unstyled"
              aria-label="Brush size"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleReset}
            variant="unstyled"
            className="rounded-lg p-2 text-text-secondary hover:bg-surface-hover dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover"
            aria-label="Reset image to original"
          >
            <RotateCcw className="h-5 w-5" />
          </Button>
          <Button
            onClick={handleSave}
            variant="unstyled"
            className="flex items-center gap-2 rounded-lg bg-text-primary px-3 py-2 text-xs font-medium text-surface transition-colors hover:bg-text-secondary dark:bg-text-dark-primary dark:text-surface-dark dark:hover:bg-text-dark-secondary"
            disabled={!canvasReady}
          >
            <Check className="h-4 w-4" />
            Save
          </Button>
        </div>
      </div>
    </BaseModal>
  );
});
