import { memo, useMemo, lazy, Suspense } from 'react';
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

const LazyMarkdownPreview = lazy(() =>
  import('./MarkdownPreview').then((m) => ({ default: m.MarkdownPreview })),
);
const LazyCsvPreview = lazy(() => import('./CsvPreview').then((m) => ({ default: m.CsvPreview })));
const LazyXlsxPreview = lazy(() =>
  import('./XlsxPreview').then((m) => ({ default: m.XlsxPreview })),
);
const LazyImagePreview = lazy(() =>
  import('./ImagePreview').then((m) => ({ default: m.ImagePreview })),
);
const LazyHtmlPreview = lazy(() =>
  import('./HtmlPreview').then((m) => ({ default: m.HtmlPreview })),
);
const LazyPowerPointPreview = lazy(() =>
  import('./PowerPointPreview').then((m) => ({ default: m.PowerPointPreview })),
);
const LazyPDFPreview = lazy(() => import('./PDFPreview').then((m) => ({ default: m.PDFPreview })));

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
