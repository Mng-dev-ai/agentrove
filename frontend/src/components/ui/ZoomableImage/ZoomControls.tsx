import clsx from 'clsx';
import { Scan, ScanSearch, ZoomIn, ZoomOut } from 'lucide-react';
import { PreviewToolbarButton } from '@/components/ui/PreviewToolbar/PreviewToolbar';
import type { ImageZoom } from './useImageZoom';
import styles from './ZoomControls.module.scss';

export function ZoomControls({ zoom, className }: { zoom: ImageZoom; className?: string }) {
  const isFit = zoom.zoom === 'fit';
  return (
    <span className={clsx(styles.controls, className)}>
      <PreviewToolbarButton
        label="Zoom out"
        shortcut="−"
        icon={ZoomOut}
        onClick={zoom.zoomOut}
        disabled={!zoom.canZoomOut}
      />
      <span className={styles.level}>{zoom.isReady ? `${Math.round(zoom.scale * 100)}%` : ''}</span>
      <PreviewToolbarButton
        label="Zoom in"
        shortcut="+"
        icon={ZoomIn}
        onClick={zoom.zoomIn}
        disabled={!zoom.canZoomIn}
      />
      <PreviewToolbarButton
        label={isFit ? 'Actual size' : 'Fit to window'}
        shortcut={isFit ? '1' : '0'}
        icon={isFit ? ScanSearch : Scan}
        onClick={zoom.toggle}
        disabled={!zoom.canToggle}
      />
    </span>
  );
}
