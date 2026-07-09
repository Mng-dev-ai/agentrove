import { memo } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip/FloatingTooltip';
import styles from './PreviewHeader.module.scss';

export interface PreviewHeaderProps {
  fileName: string;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const PreviewHeader = memo(function PreviewHeader({
  fileName,
  isFullscreen = false,
  onToggleFullscreen,
}: PreviewHeaderProps) {
  return (
    <div className={styles['preview-header']}>
      <h3 className={styles.title}>{fileName}</h3>
      {onToggleFullscreen && (
        <FloatingTooltip
          content={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          className={styles['tooltip-anchor']}
        >
          <Button
            onClick={onToggleFullscreen}
            variant="unstyled"
            className={styles['toggle-button']}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? (
              <Minimize2 className={styles.icon} />
            ) : (
              <Maximize2 className={styles.icon} />
            )}
          </Button>
        </FloatingTooltip>
      )}
    </div>
  );
});
