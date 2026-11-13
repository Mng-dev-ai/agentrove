import { memo, ReactNode } from 'react';
import clsx from 'clsx';
import { PreviewHeader, PreviewHeaderProps } from './PreviewHeader';
import styles from './PreviewContainer.module.scss';

interface PreviewContainerProps extends PreviewHeaderProps {
  children: ReactNode;
  contentClassName?: string;
  disableContentWrapper?: boolean;
}

export const PreviewContainer = memo(function PreviewContainer({
  fileName,
  isFullscreen,
  onToggleFullscreen,
  children,
  contentClassName = '',
  disableContentWrapper = false,
}: PreviewContainerProps) {
  return (
    <div className={styles['preview-container']}>
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
