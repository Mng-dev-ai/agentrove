import { memo } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { FloatingTooltip } from '@/components/ui/FloatingTooltip';

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
    <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface-secondary p-4 dark:border-border-dark dark:bg-surface-dark-secondary">
      <h3 className="text-sm font-medium text-text-primary dark:text-text-dark-primary">
        {fileName}
      </h3>
      {onToggleFullscreen && (
        <FloatingTooltip
          content={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          className="flex"
        >
          <Button
            onClick={onToggleFullscreen}
            variant="unstyled"
            className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-surface-hover dark:text-text-dark-secondary dark:hover:bg-surface-dark-hover"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </FloatingTooltip>
      )}
    </div>
  );
});
