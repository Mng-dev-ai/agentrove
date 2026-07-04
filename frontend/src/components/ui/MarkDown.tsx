import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useMemo, useState, memo, useEffect, lazy, Suspense } from 'react';
import type { Components, Options } from 'react-markdown';
import type { AnchorHTMLAttributes, HTMLAttributes, ImgHTMLAttributes } from 'react';
import { AttachmentViewer } from './AttachmentViewer';
import { Button } from './primitives/Button';
import { Link } from './primitives/Link';
import type { MessageAttachment } from '@/types/chat.types';
import { isImageUrl } from '@/utils/fileTypes';

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

// Matches a line that can safely start a new markdown block. Indented lines,
// list items, and blockquote lines must stay attached to the previous block —
// splitting a loose list or nested content would change how it renders.
const SAFE_BLOCK_START_RE = /^(?![ \t]|[-*+] |\d+[.)] |>)\S/;
// Captures the fence marker and any trailing info string separately — closing
// a fence requires matching the opening marker, not just any 3+ fence chars.
const CODE_FENCE_LINE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
const MATH_FENCE_LINE_RE = /^\s*\$\$\s*$/;

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

// Split markdown into block-level chunks at blank lines outside code/math
// fences. Streaming only appends text, so completed chunks stay byte-identical
// across flushes and their memoized renderers skip re-parsing entirely.
// Blocks parse in isolation, breaking cross-block reference links/footnotes —
// so this only runs on actively streaming content; static renders and the
// final parse at stream end get full document semantics.
function splitMarkdownBlocks(md: string): string[] {
  const lines = md.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let openFence: string | null = null;
  let inMathFence = false;
  let pendingBlanks = 0;

  for (const line of lines) {
    if (!openFence && !inMathFence && line.trim() === '') {
      if (current.length > 0) pendingBlanks++;
      continue;
    }
    if (pendingBlanks > 0) {
      if (SAFE_BLOCK_START_RE.test(line)) {
        blocks.push(current.join('\n'));
        current = [];
      } else {
        // Blank lines inside a loose list / continuation must be preserved
        for (let i = 0; i < pendingBlanks; i++) current.push('');
      }
      pendingBlanks = 0;
    }
    current.push(line);
    const fence = inMathFence ? null : CODE_FENCE_LINE_RE.exec(line);
    if (fence) {
      if (!openFence) {
        openFence = fence[1];
      } else if (
        // Per CommonMark, a closing fence uses the same character, is at least
        // as long as the opener, and has no info string — so ``` examples
        // inside a ```` fence don't end the block early.
        fence[1][0] === openFence[0] &&
        fence[1].length >= openFence.length &&
        fence[2].trim() === ''
      ) {
        openFence = null;
      }
    } else if (!openFence && MATH_FENCE_LINE_RE.test(line)) {
      inMathFence = !inMathFence;
    }
  }
  if (current.length > 0) blocks.push(current.join('\n'));
  return blocks;
}

interface CodeBlockProps extends HTMLAttributes<HTMLElement> {
  language: string;
  codeContent: string;
}

const CodeBlock = ({ language, codeContent, className, ...props }: CodeBlockProps) => {
  // Copied state lives here, not in MarkDownInner, so a copy click doesn't
  // change the components mapping identity and re-parse every memoized block.
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(codeContent);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className="group relative my-4">
      <div className="absolute right-0 top-0 z-10 flex overflow-hidden rounded-bl">
        <div className="border-b border-l border-border bg-surface-secondary/50 px-1.5 py-0.5 text-xs font-medium text-text-tertiary dark:border-border-dark dark:bg-surface-dark-secondary dark:text-text-dark-tertiary">
          {language}
        </div>
        <Button
          onClick={handleCopy}
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
};

// Module-level so every MarkdownBlock sees the same components identity forever
// — the memo on completed blocks never busts after CodeBlock took copy state.
const MARKDOWN_COMPONENTS: Components = {
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
    <td className="px-3 py-2 text-xs text-text-secondary dark:text-text-dark-secondary" {...props}>
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
        className="mb-3 whitespace-pre-wrap leading-relaxed text-text-secondary [overflow-wrap:anywhere] last:mb-0 dark:text-text-dark-secondary"
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

    return (
      <CodeBlock language={language} codeContent={codeContent} className={className} {...props} />
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
    <li
      className="pl-1 leading-relaxed text-text-secondary dark:text-text-dark-secondary"
      {...props}
    >
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
      <Link
        href={href}
        variant="unstyled"
        className="text-text-primary underline transition-colors hover:text-text-secondary dark:text-text-dark-primary dark:hover:text-text-dark-secondary"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </Link>
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
};

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
}

function MarkDownInner({ content, className = '', streaming = false }: MarkDownProps) {
  const [remarkMathPlugin, setRemarkMathPlugin] = useState<unknown>(null);
  const [rehypeKatexPlugin, setRehypeKatexPlugin] = useState<unknown>(null);

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

  return (
    <div className={mdClassName}>
      {blocks.map((seg, i) =>
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
}

const MarkDown = memo(MarkDownInner);
export default MarkDown;
