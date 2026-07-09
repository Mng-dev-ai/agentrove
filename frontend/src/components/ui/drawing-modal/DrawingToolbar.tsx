import clsx from 'clsx';
import { Check, Pencil, RotateCcw } from 'lucide-react';
import { Button } from '../primitives/Button/Button';
import { Input } from '../primitives/Input/Input';
import styles from './DrawingToolbar.module.scss';

interface DrawingToolbarProps {
  colors: string[];
  color: string;
  onColorSelect: (color: string) => void;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  onReset: () => void;
  onSave: () => void;
  canvasReady: boolean;
}

export function DrawingToolbar({
  colors,
  color,
  onColorSelect,
  brushSize,
  onBrushSizeChange,
  onReset,
  onSave,
  canvasReady,
}: DrawingToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.group}>
        <div className={styles.swatches}>
          {colors.map((c) => (
            <Button
              key={c}
              onClick={() => onColorSelect(c)}
              variant="unstyled"
              className={clsx(styles.swatch, color === c && styles['swatch--selected'])}
              // Drawing palette colors are literal ink, not theme tokens.
              style={{ backgroundColor: c }}
              aria-label={`Select color ${c}`}
              aria-pressed={color === c}
            />
          ))}
        </div>

        <div className={styles.brush}>
          <Pencil className={styles['brush-icon']} />
          <Input
            type="range"
            min="1"
            max="20"
            value={brushSize}
            onChange={(e) => onBrushSizeChange(Number(e.target.value))}
            className={styles['brush-range']}
            variant="unstyled"
            aria-label="Brush size"
          />
        </div>
      </div>

      <div className={styles.actions}>
        <Button
          onClick={onReset}
          variant="unstyled"
          className={styles['icon-button']}
          aria-label="Reset image to original"
        >
          <RotateCcw className={styles['icon-button-icon']} />
        </Button>
        <Button
          onClick={onSave}
          variant="unstyled"
          className={styles['save-button']}
          disabled={!canvasReady}
        >
          <Check className={styles['save-icon']} />
          Save
        </Button>
      </div>
    </div>
  );
}
