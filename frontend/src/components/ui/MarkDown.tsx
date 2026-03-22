import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMemo, useState, useCallback, memo, useEffect, lazy, Suspense } from 'react';
import type { Components } from 'react-markdown';
import type { AnchorHTMLAttributes, HTMLAttributes, ImgHTMLAttributes } from 'react';
import { AttachmentViewer } from './AttachmentViewer';
import { Button } from './primitives/Button';
import type { MessageAttachment } from '@/types/chat.types';
import { isImageUrl } from '@/utils/fileTypes';
import { copyToClipboard } from '@/hooks/useClipboard';

const Mermaid = lazy(() => import('./Mermaid').then((m) => ({ default: m.Mermaid })));
const VisualWidget = lazy(() =>
  import('./VisualWidget').then((m) => ({ default: m.VisualWidget })),
);

type CommonProps = {
  children?: React.ReactNode;
} & HTMLAttributes<HTMLElement>;

interface CodeProps extends CommonProps {
  inline?: boolean;
  className?: string;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement>;

type ImageProps = ImgHTMLAttributes<HTMLImageElement>;

const MATH_PATTERN = /(^|[^\\])(\$[^$\n]+\$|\$\$[\s\S]*?\$\$|\\\(|\\\[)/;

// Matches an unclosed ```visualizer block at the end of streaming content.
// Captures the partial content so it can be rendered as a live preview.
const UNCLOSED_VISUALIZER_RE = /```visualizer\n([\s\S]*)$/;

// Matches just the opening fence without any content yet (no newline after "visualizer").
const OPENING_VISUALIZER_RE = /```visualizer$/;

// Matches a complete ```visualizer ... ``` block.
const CLOSED_VISUALIZER_RE = /```visualizer\n([\s\S]*?)```/g;

const createImageAttachment = (url: string, alt?: string): MessageAttachment => {
  return {
    id: url,
    file_url: url,
    file_type: 'image',
    filename: url.split('/').pop() || alt || 'image.jpg',
    message_id: '',
    created_at: '',
  };
};

// Split content into segments: markdown text and visualizer blocks.
// Completed blocks are rendered with stable keys outside react-markdown so they
// survive parent re-renders during streaming without iframe remount.
// Unclosed visualizer fences (still streaming) are rendered as live previews.
function splitVisualizerBlocks(raw: string): Array<{ type: 'md' | 'visualizer'; content: string }> {
  const segments: Array<{ type: 'md' | 'visualizer'; content: string }> = [];
  let lastIndex = 0;

  for (const match of raw.matchAll(CLOSED_VISUALIZER_RE)) {
    const before = raw.slice(lastIndex, match.index);
    if (before) segments.push({ type: 'md', content: before });
    segments.push({ type: 'visualizer', content: match[1] });
    lastIndex = match.index! + match[0].length;
  }

  const remainder = raw.slice(lastIndex);

  // Check for an unclosed visualizer fence with partial content (live preview)
  const unclosedMatch = remainder.match(UNCLOSED_VISUALIZER_RE);
  if (unclosedMatch) {
    const before = remainder.slice(0, unclosedMatch.index);
    if (before) segments.push({ type: 'md', content: before });
    if (unclosedMatch[1]) segments.push({ type: 'visualizer', content: unclosedMatch[1] });
  } else if (OPENING_VISUALIZER_RE.test(remainder)) {
    // Just the opening fence, no content yet — strip it from markdown
    const before = remainder.replace(OPENING_VISUALIZER_RE, '');
    if (before) segments.push({ type: 'md', content: before });
  } else {
    if (remainder) segments.push({ type: 'md', content: remainder });
  }

  return segments;
}

function MarkDownInner({ content, className = '' }: { content: string; className?: string }) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [remarkMathPlugin, setRemarkMathPlugin] = useState<unknown>(null);
  const [rehypeKatexPlugin, setRehypeKatexPlugin] = useState<unknown>(null);

  const segments = useMemo(() => splitVisualizerBlocks(content), [content]);

  const needsMath = useMemo(() => MATH_PATTERN.test(content), [content]);

  useEffect(() => {
    let cancelled = false;

    if (!needsMath || (remarkMathPlugin && rehypeKatexPlugin)) {
      return () => {
        cancelled = true;
      };
    }

    void Promise.all([
      import('remark-math'),
      import('rehype-katex'),
      import('katex/dist/katex.min.css'),
    ]).then(([remarkMathModule, rehypeKatexModule]) => {
      if (cancelled) return;
      setRemarkMathPlugin(() => remarkMathModule.default);
      setRehypeKatexPlugin(() => rehypeKatexModule.default);
    });

    return () => {
      cancelled = true;
    };
  }, [needsMath, remarkMathPlugin, rehypeKatexPlugin]);

  const handleCopyCode = useCallback((code: string) => {
    void copyToClipboard(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  }, []);

  const components = useMemo<Components>(
    () => ({
      table: ({ children, ...props }: CommonProps) => (
        <div className="my-6 overflow-x-auto">
          <table className="min-w-full divide-y divide-border dark:divide-border-dark" {...props}>
            {children}
          </table>
        </div>
      ),
      thead: ({ children, ...props }: CommonProps) => (
        <thead className="bg-surface-secondary dark:bg-surface-dark-secondary" {...props}>
          {children}
        </thead>
      ),
      tbody: ({ children, ...props }: CommonProps) => (
        <tbody
          className="divide-y divide-border bg-surface dark:divide-border-dark dark:bg-surface-dark"
          {...props}
        >
          {children}
        </tbody>
      ),
      tr: ({ children, ...props }: CommonProps) => (
        <tr
          className="transition-colors hover:bg-surface-hover dark:hover:bg-surface-dark-hover"
          {...props}
        >
          {children}
        </tr>
      ),
      th: ({ children, ...props }: CommonProps) => (
        <th
          className="px-3 py-2 text-left text-xs font-semibold text-text-primary dark:text-text-dark-primary"
          {...props}
        >
          {children}
        </th>
      ),
      td: ({ children, ...props }: CommonProps) => (
        <td
          className="px-3 py-2 text-xs text-text-secondary dark:text-text-dark-secondary"
          {...props}
        >
          {children}
        </td>
      ),

      h1: ({ children, ...props }: CommonProps) => (
        <h1
          className="mb-3 mt-4 text-lg font-semibold text-text-primary first:mt-0 dark:text-text-dark-primary"
          {...props}
        >
          {children}
        </h1>
      ),
      h2: ({ children, ...props }: CommonProps) => (
        <h2
          className="mb-2 mt-4 text-base font-semibold text-text-primary dark:text-text-dark-primary"
          {...props}
        >
          {children}
        </h2>
      ),
      h3: ({ children, ...props }: CommonProps) => (
        <h3
          className="mb-1.5 mt-3 text-sm font-semibold text-text-primary dark:text-text-dark-primary"
          {...props}
        >
          {children}
        </h3>
      ),

      p: ({ children, ...props }: CommonProps) => {
        if (typeof children === 'string' && isImageUrl(children.trim())) {
          const url = children.trim();
          return (
            <div className="mb-3 last:mb-0">
              <AttachmentViewer attachments={[createImageAttachment(url)]} />
            </div>
          );
        }

        return (
          <p
            className="mb-3 whitespace-pre-wrap leading-5 text-text-secondary [overflow-wrap:anywhere] last:mb-0 dark:text-text-dark-secondary"
            {...props}
          >
            {children}
          </p>
        );
      },
      strong: ({ children, ...props }: CommonProps) => (
        <strong className="font-semibold text-text-primary dark:text-text-dark-primary" {...props}>
          {children}
        </strong>
      ),
      em: ({ children, ...props }: CommonProps) => (
        <em className="italic text-text-secondary dark:text-text-dark-secondary" {...props}>
          {children}
        </em>
      ),

      code: ({ inline, className, children, ...props }: CodeProps) => {
        const match = /language-(\w+)/.exec(className || '');
        const codeContent = String(children).replace(/\n$/, '');
        const hasNewlines = codeContent.includes('\n');
        const isInline = inline || (!match && !hasNewlines);

        if (isInline) {
          return (
            <code
              className={`rounded bg-surface-secondary px-1 py-0.5 font-mono text-xs text-text-primary dark:bg-surface-dark-secondary dark:text-text-dark-primary ${className || ''}`}
              {...props}
            >
              {codeContent}
            </code>
          );
        }

        if (!match) {
          return (
            <div className="my-4">
              <pre className="overflow-x-auto rounded-lg border border-border bg-surface-secondary p-2 dark:border-border-dark dark:bg-surface-dark-secondary">
                <code
                  className="font-mono text-xs text-text-primary dark:text-text-dark-primary"
                  {...props}
                >
                  {codeContent}
                </code>
              </pre>
            </div>
          );
        }

        const language = match[1];
        if (language === 'mermaid') {
          return (
            <Suspense
              fallback={
                <pre className="overflow-x-auto rounded-lg border border-border bg-surface-secondary p-2 dark:border-border-dark dark:bg-surface-dark-secondary">
                  <code className="font-mono text-xs text-text-primary dark:text-text-dark-primary">
                    {codeContent}
                  </code>
                </pre>
              }
            >
              <Mermaid content={codeContent} />
            </Suspense>
          );
        }

        const isCopied = copiedCode === codeContent;

        return (
          <div className="group relative my-4">
            <div className="absolute right-0 top-0 z-10 flex overflow-hidden rounded-bl">
              <div className="border-b border-l border-border bg-surface-secondary/50 px-1.5 py-0.5 text-xs font-medium text-text-tertiary dark:border-border-dark dark:bg-surface-dark-secondary dark:text-text-dark-tertiary">
                {language}
              </div>
              <Button
                onClick={() => handleCopyCode(codeContent)}
                variant="unstyled"
                className="border-b border-l border-border bg-surface-secondary/50 px-1.5 py-0.5 text-xs font-medium text-text-tertiary hover:text-text-primary dark:border-border-dark dark:bg-surface-dark-secondary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
                aria-label="Copy code"
              >
                {isCopied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-lg border border-border bg-surface-secondary p-2 pt-5 dark:border-border-dark dark:bg-surface-dark-secondary">
              <code
                className={`${className || ''} font-mono text-xs text-text-primary dark:text-text-dark-primary`}
                {...props}
              >
                {codeContent}
              </code>
            </pre>
          </div>
        );
      },

      ul: ({ children, ...props }: CommonProps) => (
        <ul
          className="mb-3 list-disc space-y-1 pl-4 text-text-secondary dark:text-text-dark-secondary"
          {...props}
        >
          {children}
        </ul>
      ),
      ol: ({ children, ...props }: CommonProps) => (
        <ol
          className="mb-3 list-decimal space-y-1 pl-4 text-text-secondary dark:text-text-dark-secondary"
          {...props}
        >
          {children}
        </ol>
      ),
      li: ({ children, ...props }: CommonProps) => (
        <li className="pl-1 text-text-secondary dark:text-text-dark-secondary" {...props}>
          {children}
        </li>
      ),
      blockquote: ({ children, ...props }: CommonProps) => (
        <blockquote
          className="my-3 border-l-2 border-border pl-3 italic text-text-secondary dark:border-border-dark dark:text-text-dark-secondary"
          {...props}
        >
          {children}
        </blockquote>
      ),

      a: ({ children, href, ...props }: LinkProps) => {
        if (href && isImageUrl(href)) {
          return <AttachmentViewer attachments={[createImageAttachment(href)]} />;
        }

        return (
          <a
            href={href}
            className="text-text-primary underline transition-colors hover:text-text-secondary dark:text-text-dark-primary dark:hover:text-text-dark-secondary"
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          >
            {children}
          </a>
        );
      },

      img: ({ src, alt, ...props }: ImageProps) => {
        if (src) {
          return <AttachmentViewer attachments={[createImageAttachment(src, alt)]} />;
        }

        return (
          <img
            className="my-4 h-auto max-w-full rounded-lg border border-border dark:border-border-dark"
            alt={alt || ''}
            loading="lazy"
            {...props}
          />
        );
      },

      hr: (props: HTMLAttributes<HTMLHRElement>) => (
        <hr className="my-6 border-border dark:border-border-dark" {...props} />
      ),

      pre: ({ children, ...props }: CommonProps) => (
        <pre className="overflow-x-auto" {...props}>
          {children}
        </pre>
      ),
    }),
    [copiedCode, handleCopyCode],
  );

  const remarkPlugins = useMemo(
    () => [remarkGfm, ...(remarkMathPlugin ? [remarkMathPlugin as never] : [])],
    [remarkMathPlugin],
  );
  const rehypePlugins = useMemo(
    () => (rehypeKatexPlugin ? ([rehypeKatexPlugin] as never[]) : []),
    [rehypeKatexPlugin],
  );
  const mdClassName = `text-sm text-text-secondary dark:text-text-dark-secondary ${className}`;

  const mathPluginsLoading = needsMath && (!remarkMathPlugin || !rehypeKatexPlugin);

  if (mathPluginsLoading) {
    return (
      <div
        className={`whitespace-pre-wrap text-sm text-text-secondary dark:text-text-dark-secondary ${className}`}
      >
        {content}
      </div>
    );
  }

  const hasSingleMdSegment = segments.length === 1 && segments[0].type === 'md';

  if (hasSingleMdSegment) {
    return (
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        className={mdClassName}
        components={components}
      >
        {segments[0].content}
      </ReactMarkdown>
    );
  }

  return (
    <div className={mdClassName}>
      {segments.map((seg, i) =>
        seg.type === 'visualizer' ? (
          <Suspense
            key={`viz-${i}`}
            fallback={
              <div className="my-4 flex h-[200px] items-center justify-center rounded-lg border border-border/50 bg-surface-secondary dark:border-border-dark/50 dark:bg-surface-dark-secondary">
                <span className="text-xs text-text-tertiary dark:text-text-dark-tertiary">
                  Loading visualization...
                </span>
              </div>
            }
          >
            <VisualWidget code={seg.content} />
          </Suspense>
        ) : (
          <ReactMarkdown
            key={`md-${i}`}
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            components={components}
          >
            {seg.content}
          </ReactMarkdown>
        ),
      )}
    </div>
  );
}

const MarkDown = memo(MarkDownInner);
export default MarkDown;
