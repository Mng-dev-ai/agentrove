import { lazy, Suspense } from 'react';
import type { Components } from 'react-markdown';
import type { AnchorHTMLAttributes, HTMLAttributes, ImgHTMLAttributes } from 'react';
import clsx from 'clsx';
import { AttachmentViewer } from '../attachment-viewer/AttachmentViewer';
import { Link } from '../primitives/Link/Link';
import { isImageUrl } from '@/utils/fileTypes';
import { createImageAttachment } from './markdownParsing';
import { CodeBlock } from './CodeBlock';
import styles from './markdownComponents.module.scss';

const Mermaid = lazy(() => import('../Mermaid/Mermaid').then((m) => ({ default: m.Mermaid })));

type CommonProps = {
  children?: React.ReactNode;
} & HTMLAttributes<HTMLElement>;

interface CodeProps extends CommonProps {
  inline?: boolean;
  className?: string;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement>;

type ImageProps = ImgHTMLAttributes<HTMLImageElement>;

// Module-level so every MarkdownBlock sees the same components identity forever
// — the memo on completed blocks never busts after CodeBlock took copy state.
export const MARKDOWN_COMPONENTS: Components = {
  table: ({ children, ...props }: CommonProps) => (
    <div className={styles['table-wrap']}>
      <table className={styles.table} {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }: CommonProps) => (
    <thead className={styles.thead} {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }: CommonProps) => (
    <tbody className={styles.tbody} {...props}>
      {children}
    </tbody>
  ),
  tr: ({ children, ...props }: CommonProps) => (
    <tr className={styles.tr} {...props}>
      {children}
    </tr>
  ),
  th: ({ children, ...props }: CommonProps) => (
    <th className={styles.th} {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }: CommonProps) => (
    <td className={styles.td} {...props}>
      {children}
    </td>
  ),

  h1: ({ children, ...props }: CommonProps) => (
    <h1 className={styles.h1} {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: CommonProps) => (
    <h2 className={styles.h2} {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: CommonProps) => (
    <h3 className={styles.h3} {...props}>
      {children}
    </h3>
  ),

  p: ({ children, ...props }: CommonProps) => {
    if (typeof children === 'string' && isImageUrl(children.trim())) {
      const url = children.trim();
      return (
        <div className={styles['image-paragraph']}>
          <AttachmentViewer attachments={[createImageAttachment(url)]} />
        </div>
      );
    }

    return (
      <p className={styles.p} {...props}>
        {children}
      </p>
    );
  },
  strong: ({ children, ...props }: CommonProps) => (
    <strong className={styles.strong} {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }: CommonProps) => (
    <em className={styles.em} {...props}>
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
        <code className={clsx(styles['code-inline'], className)} {...props}>
          {codeContent}
        </code>
      );
    }

    if (!match) {
      return (
        <div className={styles['plain-code-block']}>
          <pre className={styles['plain-pre']}>
            <code className={styles['code-content']} {...props}>
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
            <pre className={styles['plain-pre']}>
              <code className={styles['code-content']}>{codeContent}</code>
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
    <ul className={styles.ul} {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: CommonProps) => (
    <ol className={styles.ol} {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }: CommonProps) => (
    <li className={styles.li} {...props}>
      {children}
    </li>
  ),
  blockquote: ({ children, ...props }: CommonProps) => (
    <blockquote className={styles.blockquote} {...props}>
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
        className={styles.link}
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

    return <img className={styles.img} alt={alt || ''} loading="lazy" {...props} />;
  },

  hr: (props: HTMLAttributes<HTMLHRElement>) => <hr className={styles.hr} {...props} />,

  pre: ({ children, ...props }: CommonProps) => (
    <pre className={styles.pre} {...props}>
      {children}
    </pre>
  ),
};
