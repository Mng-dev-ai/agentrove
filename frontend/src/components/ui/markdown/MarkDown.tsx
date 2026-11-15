import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useMemo, memo } from 'react';
import type { Options } from 'react-markdown';
import { MARKDOWN_COMPONENTS } from './markdownComponents';
import { MATH_PATTERN, rehypeMentionPills, splitMarkdownBlocks } from './markdownParsing';
import styles from './MarkDown.module.scss';

function markdownUrlTransform(url: string, key: string): string {
  const colon = url.indexOf(':');
  if (key === 'href' && colon > 0 && url.slice(0, colon).toLowerCase() === 'file') return url;
  return defaultUrlTransform(url);
}

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
  // Per-block memo: streaming only re-parses the growing tail block each flush.
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={MARKDOWN_COMPONENTS}
      urlTransform={markdownUrlTransform}
    >
      {content}
    </ReactMarkdown>
  );
});

interface MarkDownProps {
  content: string;
  // While streaming, split blocks for cheap incremental re-parse (breaks cross-block refs).
  streaming?: boolean;
  // @mention /command pills — user messages only.
  highlightMentions?: boolean;
}

export const MarkDown = memo(function MarkDown({
  content,
  streaming = false,
  highlightMentions = false,
}: MarkDownProps) {
  const blocks = useMemo(
    () => (streaming ? splitMarkdownBlocks(content) : [content]),
    [content, streaming],
  );

  // Only include the math plugins when the content actually contains math, so
  // stray `$` characters in ordinary text aren't parsed as TeX.
  const needsMath = useMemo(() => MATH_PATTERN.test(content), [content]);

  const remarkPlugins = useMemo<NonNullable<Options['remarkPlugins']>>(
    () => (needsMath ? [remarkGfm, [remarkMath, { singleDollarTextMath: false }]] : [remarkGfm]),
    [needsMath],
  );
  const rehypePlugins = useMemo(
    () => [...(highlightMentions ? [rehypeMentionPills] : []), ...(needsMath ? [rehypeKatex] : [])],
    [needsMath, highlightMentions],
  );

  return (
    <div className={styles.markdown}>
      {blocks.map((block, i) => (
        <MarkdownBlock
          key={i}
          content={block}
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
        />
      ))}
    </div>
  );
});
