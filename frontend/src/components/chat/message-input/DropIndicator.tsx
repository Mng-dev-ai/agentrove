import { Image, FileText, FileSpreadsheet, Upload } from 'lucide-react';
import clsx from 'clsx';
import styles from './DropIndicator.module.scss';

export interface DropIndicatorProps {
  visible: boolean;
  fileType?: 'image' | 'pdf' | 'xlsx' | 'any';
  message?: string;
  className?: string;
}

interface IconWrapperProps {
  children: React.ReactNode;
}

function IconWrapper({ children }: IconWrapperProps) {
  return (
    <div className={styles['icon-wrapper']}>
      <div className={styles.glow}></div>
      <div className={styles['icon-badge']}>{children}</div>
    </div>
  );
}

export function DropIndicator({
  visible,
  fileType = 'image',
  message = 'Drop image here',
  className = '',
}: DropIndicatorProps) {
  if (!visible) return null;

  return (
    <div className={clsx(styles['drop-indicator'], className)}>
      <div className={styles.content}>
        <IconWrapper>
          {fileType === 'image' ? (
            <Image className={styles.icon} />
          ) : fileType === 'pdf' ? (
            <FileText className={styles.icon} />
          ) : fileType === 'xlsx' ? (
            <FileSpreadsheet className={styles.icon} />
          ) : (
            <Upload className={styles.icon} />
          )}
        </IconWrapper>
        <p className={styles.title}>{message}</p>
        <div className={styles.hint}>
          {fileType === 'image'
            ? 'PNG • JPEG • GIF • WebP'
            : fileType === 'pdf'
              ? 'PDF documents'
              : fileType === 'xlsx'
                ? 'Excel documents'
                : 'Release to upload'}
        </div>
      </div>
    </div>
  );
}
