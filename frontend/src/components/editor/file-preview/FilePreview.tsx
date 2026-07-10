import { memo, useMemo, Suspense } from 'react';
import { lazyNamed } from '@/utils/lazyNamed';
import type { ComponentType } from 'react';
import { createPortal } from 'react-dom';
import type { FileStructure } from '@/types/file-system.types';
import {
  isCsvFile,
  isMarkdownFile,
  isXlsxFile,
  isImageFile,
  isHtmlFile,
  isPowerPointFile,
  isPdfFile,
} from '@/utils/fileTypes';
import styles from './FilePreview.module.scss';

type PreviewComponentProps = {
  file: FileStructure;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
};

type PreviewComponent = ComponentType<PreviewComponentProps>;

const LazyMarkdownPreview = lazyNamed(() => import('./MarkdownPreview'), 'MarkdownPreview');
const LazyCsvPreview = lazyNamed(() => import('./CsvPreview'), 'CsvPreview');
const LazyXlsxPreview = lazyNamed(() => import('./XlsxPreview'), 'XlsxPreview');
const LazyImagePreview = lazyNamed(() => import('./ImagePreview'), 'ImagePreview');
const LazyHtmlPreview = lazyNamed(() => import('./HtmlPreview'), 'HtmlPreview');
const LazyPowerPointPreview = lazyNamed(() => import('./PowerPointPreview'), 'PowerPointPreview');
const LazyPDFPreview = lazyNamed(() => import('./PDFPreview'), 'PDFPreview');

interface PreviewRenderer {
  match: (file: FileStructure) => boolean;
  Component: PreviewComponent;
}

const previewRenderers: PreviewRenderer[] = [
  { match: isMarkdownFile, Component: LazyMarkdownPreview },
  { match: isCsvFile, Component: LazyCsvPreview },
  { match: isXlsxFile, Component: LazyXlsxPreview },
  { match: isImageFile, Component: LazyImagePreview },
  { match: isHtmlFile, Component: LazyHtmlPreview },
  { match: isPowerPointFile, Component: LazyPowerPointPreview },
  { match: isPdfFile, Component: LazyPDFPreview },
];

export interface FilePreviewProps {
  file: FileStructure;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const FilePreview = memo(function FilePreview({
  file,
  isFullscreen = false,
  onToggleFullscreen,
}: FilePreviewProps) {
  const matchedPreview = useMemo(() => previewRenderers.find(({ match }) => match(file)), [file]);

  const MatchedComponent = matchedPreview?.Component;

  if (!MatchedComponent) {
    return null;
  }

  const previewContent = (
    <Suspense fallback={null}>
      <MatchedComponent
        file={file}
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
      />
    </Suspense>
  );

  if (isFullscreen) {
    if (typeof document === 'undefined') {
      return previewContent;
    }

    return createPortal(
      <div className={styles['fullscreen-overlay']}>{previewContent}</div>,
      document.body,
    );
  }

  return previewContent;
});
