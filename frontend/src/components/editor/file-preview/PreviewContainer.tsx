import { memo, ReactNode } from 'react';
import clsx from 'clsx';
import { PreviewHeader, PreviewHeaderProps } from './PreviewHeader';
import styles from './PreviewContainer.module.scss';

interface PreviewContainerProps extends PreviewHeaderProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  disableContentWrapper?: boolean;
}

export const PreviewContainer = memo(function PreviewContainer({
  fileName,
  isFullscreen,
  onToggleFullscreen,
  children,
  className = '',
  contentClassName = '',
  disableContentWrapper = false,
}: PreviewContainerProps) {
  return (
    <div className={clsx(styles['preview-container'], className)}>
      {isFullscreen && (
        <PreviewHeader
          fileName={fileName}
          isFullscreen={isFullscreen}
          onToggleFullscreen={onToggleFullscreen}
        />
      )}

      {disableContentWrapper ? (
        children
      ) : (
        <div className={clsx(styles.content, contentClassName)}>{children}</div>
      )}
    </div>
  );
});
