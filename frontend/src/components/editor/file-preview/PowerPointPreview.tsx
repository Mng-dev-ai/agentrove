import { memo, useState } from 'react';
import clsx from 'clsx';
import { logger } from '@/utils/logger';
import { base64ToUint8Array } from '@/utils/base64';
import type { FileStructure } from '@/types/file-system.types';
import { Button } from '@/components/ui/primitives/Button/Button';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { PreviewContainer } from './PreviewContainer';
import { PreviewEmptyState } from './PreviewEmptyState';
import { getDisplayFileName, isValidBase64 } from './previewUtils';
import styles from './PowerPointPreview.module.scss';

const TEXT_CONTENT_RE = /<a:t>([^<]+)<\/a:t>/g;
const TITLE_CONTENT_RE = /<p:ph[^>]*type="title"[^>]*>.*?<a:t>([^<]+)<\/a:t>/gs;
const SLIDE_NUMBER_RE = /slide(\d+)\.xml$/;

export interface PowerPointPreviewProps {
  file: FileStructure;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

interface SlideData {
  slideNumber: number;
  content: string;
  hasImages: boolean;
}

const parseSlideContent = (xmlContent: string): string => {
  const textContent: string[] = [];

  const textMatches = xmlContent.matchAll(TEXT_CONTENT_RE);
  for (const match of textMatches) {
    textContent.push(match[1]);
  }

  const titleMatches = xmlContent.matchAll(TITLE_CONTENT_RE);
  for (const match of titleMatches) {
    textContent.unshift(`## ${match[1]}`);
  }

  return textContent.join('\n\n');
};

export const PowerPointPreview = memo(function PowerPointPreview({
  file,
  isFullscreen = false,
  onToggleFullscreen,
}: PowerPointPreviewProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [slidesData, setSlidesData] = useState<SlideData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const fileName = getDisplayFileName(file, 'presentation');

  useAsyncEffect(
    async (cancelled) => {
      setSlidesData([]);
      setCurrentSlide(0);

      if (!file.content || !isValidBase64(file.content)) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        const bytes = base64ToUint8Array(file.content);

        const { default: JSZip } = await import('jszip');
        const pptx = await new JSZip().loadAsync(bytes);

        const slideRels = pptx.file(/^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/);
        const slideFiles = pptx.file(/^ppt\/slides\/slide\d+\.xml$/);
        const sortedSlides = slideFiles.sort((a, b) => {
          const aMatch = a.name.match(SLIDE_NUMBER_RE);
          const bMatch = b.name.match(SLIDE_NUMBER_RE);
          const aNum = aMatch ? parseInt(aMatch[1], 10) : 0;
          const bNum = bMatch ? parseInt(bMatch[1], 10) : 0;
          return aNum - bNum;
        });

        const slides: SlideData[] = [];

        for (let i = 0; i < sortedSlides.length; i++) {
          const slideFile = sortedSlides[i];
          const xmlContent = await slideFile.async('string');

          let hasImages = false;
          const relFile = slideRels.find((rel) => rel.name.includes(`slide${i + 1}.xml.rels`));
          if (relFile) {
            const relContent = await relFile.async('string');
            hasImages = relContent.includes('image');
          }

          slides.push({
            slideNumber: i + 1,
            content: parseSlideContent(xmlContent),
            hasImages,
          });
        }

        if (cancelled()) return;

        setSlidesData(slides);
        setCurrentSlide(0);
      } catch (error) {
        logger.error('PowerPoint preview load failed', 'PowerPointPreview', error);
        if (!cancelled()) {
          setSlidesData([]);
        }
      } finally {
        if (!cancelled()) {
          setIsLoading(false);
        }
      }
    },
    [file.content],
  );

  if (isLoading) {
    return (
      <PreviewEmptyState
        fileName={fileName}
        message="Loading PowerPoint presentation..."
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
      />
    );
  }

  if (slidesData.length === 0) {
    return (
      <PreviewEmptyState
        fileName={fileName}
        message="Unable to load PowerPoint presentation"
        isFullscreen={isFullscreen}
        onToggleFullscreen={onToggleFullscreen}
      />
    );
  }

  const currentSlideData = slidesData[currentSlide];

  const handlePreviousSlide = () => {
    setCurrentSlide((prev) => Math.max(0, prev - 1));
  };

  const handleNextSlide = () => {
    setCurrentSlide((prev) => Math.min(slidesData.length - 1, prev + 1));
  };

  return (
    <PreviewContainer
      fileName={fileName}
      isFullscreen={isFullscreen}
      onToggleFullscreen={onToggleFullscreen}
      disableContentWrapper
    >
      <div className={styles['powerpoint-preview']}>
        <div className={styles['slide-area']}>
          <div
            className={clsx(styles['slide-card'], isFullscreen && styles['slide-card--fullscreen'])}
          >
            {currentSlideData && (
              <div className={styles['slide-content']}>
                {currentSlideData.content.split('\n\n').map((paragraph, idx) => {
                  if (paragraph.startsWith('## ')) {
                    return (
                      <h2 key={idx} className={styles['slide-title']}>
                        {paragraph.substring(3)}
                      </h2>
                    );
                  }
                  return (
                    <p key={idx} className={styles['slide-paragraph']}>
                      {paragraph}
                    </p>
                  );
                })}
                {currentSlideData.hasImages && (
                  <p className={styles['slide-note']}>
                    Note: This slide contains images that are not displayed in the preview
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <Button
            onClick={handlePreviousSlide}
            disabled={currentSlide === 0}
            variant="unstyled"
            className={styles['nav-button']}
          >
            Previous
          </Button>

          <div className={styles['slide-status']}>
            <span className={styles['slide-counter']}>
              Slide {currentSlide + 1} of {slidesData.length}
            </span>
            <div className={styles.dots}>
              {slidesData.map((_, idx) => (
                <Button
                  key={idx}
                  onClick={() => setCurrentSlide(idx)}
                  variant="unstyled"
                  className={clsx(styles.dot, idx === currentSlide && styles['dot--active'])}
                  aria-label={`Go to slide ${idx + 1}`}
                />
              ))}
            </div>
          </div>

          <Button
            onClick={handleNextSlide}
            disabled={currentSlide === slidesData.length - 1}
            variant="unstyled"
            className={styles['nav-button']}
          >
            Next
          </Button>
        </div>
      </div>
    </PreviewContainer>
  );
});
