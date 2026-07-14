import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useMemo, memo, Suspense } from 'react';
import { lazyNamed } from '@/utils/lazyNamed';
import type { Options } from 'react-markdown';
import clsx from 'clsx';
import { MARKDOWN_COMPONENTS } from './markdownComponents';
import {
  MATH_PATTERN,
  rehypeMentionPills,
  splitMarkdownBlocks,
  splitVisualizerBlocks,
} from './markdownParsing';
import styles from './MarkDown.module.scss';

const VisualWidget = lazyNamed(() => import('../VisualWidget/VisualWidget'), 'VisualWidget');

interface MarkdownBlockProps {
  content: string;
  remarkPlugins: Options['remarkPlugins'];
  rehypePlugins: Options['rehypePlugins'];
}

const MarkdownBlock = memo(function MarkdownBlock({
  content,
  remarkPlugins,
  rehypePlugins,
}: MarkdownBlockProps) {
  // Memoized per block so a streaming message only re-parses its growing tail
  // block each flush; completed blocks keep identical props and bail out.
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  );
});

interface MarkDownProps {
  content: string;
  className?: string;
  // True only while this content is actively receiving stream output — block
  // splitting trades cross-block references for cheap incremental re-parses,
  // so static content parses as one document.
  streaming?: boolean;
  // Render @mention and leading /command tokens as pills — user messages only.
  highlightMentions?: boolean;
}

export const MarkDown = memo(function MarkDown({
  content,
  className,
  streaming = false,
  highlightMentions = false,
}: MarkDownProps) {
  const blocks = useMemo(
    () =>
      splitVisualizerBlocks(content).flatMap((seg) =>
        seg.type === 'md' && streaming
          ? splitMarkdownBlocks(seg.content).map((chunk) => ({
              type: 'md' as const,
              content: chunk,
            }))
          : [seg],
      ),
    [content, streaming],
  );

  // Only include the math plugins when the content actually contains math, so
  // stray `$` characters in ordinary text aren't parsed as TeX.
  const needsMath = useMemo(() => MATH_PATTERN.test(content), [content]);

  const remarkPlugins = useMemo(
    () => (needsMath ? [remarkGfm, remarkMath] : [remarkGfm]),
    [needsMath],
  );
  const rehypePlugins = useMemo(
    () => [...(highlightMentions ? [rehypeMentionPills] : []), ...(needsMath ? [rehypeKatex] : [])],
    [needsMath, highlightMentions],
  );

  return (
    <div className={clsx(styles.markdown, className)}>
      {blocks.map((seg, i) =>
        seg.type === 'visualizer' ? (
          <Suspense
            key={`viz-${i}`}
            fallback={
              <div className={styles['viz-fallback']}>
                <span className={styles['viz-fallback-text']}>Loading visualization...</span>
              </div>
            }
          >
            <VisualWidget code={seg.content} />
          </Suspense>
        ) : (
          <MarkdownBlock
            key={`md-${i}`}
            content={seg.content}
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
          />
        ),
      )}
    </div>
  );
});
