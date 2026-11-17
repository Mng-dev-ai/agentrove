import clsx from 'clsx';
import type { ImageZoom } from './useImageZoom';
import styles from './ZoomableImage.module.scss';

interface ZoomableImageProps {
  zoom: ImageZoom;
  src: string;
  alt: string;
  tone: 'surface' | 'scrim';
  className?: string;
}

export function ZoomableImage({ zoom, src, alt, tone, className }: ZoomableImageProps) {
  return (
    <div
      ref={zoom.stageRef}
      className={clsx(
        styles.stage,
        zoom.zoom !== 'fit' && styles['stage--zoomed'],
        zoom.isDragging && styles['stage--dragging'],
        className,
      )}
      {...zoom.stageHandlers}
    >
      {src && !zoom.hasFailed && (
        <img
          key={src}
          ref={zoom.imageRef}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={zoom.onImageLoad}
          onError={zoom.onImageError}
          style={zoom.imageStyle}
          className={clsx(
            styles.image,
            styles[`image--${tone}`],
            !zoom.isReady && styles['image--pending'],
            zoom.canToggle && styles[zoom.zoom === 'fit' ? 'image--zoom-in' : 'image--zoom-out'],
          )}
        />
      )}
    </div>
  );
}
