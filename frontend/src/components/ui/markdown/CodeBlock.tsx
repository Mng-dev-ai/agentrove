import { useState } from 'react';
import type { HTMLAttributes } from 'react';
import clsx from 'clsx';
import { Button } from '../primitives/Button/Button';
import styles from './CodeBlock.module.scss';

interface CodeBlockProps extends HTMLAttributes<HTMLElement> {
  language: string;
  codeContent: string;
}

export function CodeBlock({ language, codeContent, className, ...props }: CodeBlockProps) {
  // Copied state lives here, not in MarkDown, so a copy click doesn't
  // change the components mapping identity and re-parse every memoized block.
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(codeContent);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className={styles['code-block']}>
      <div className={styles['code-header']}>
        <div className={styles['code-lang']}>{language}</div>
        <Button
          onClick={handleCopy}
          variant="unstyled"
          className={styles['code-copy']}
          aria-label="Copy code"
        >
          {isCopied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
      <pre className={styles['code-pre']}>
        <code className={clsx(className, styles['code-content'])} {...props}>
          {codeContent}
        </code>
      </pre>
    </div>
  );
}
