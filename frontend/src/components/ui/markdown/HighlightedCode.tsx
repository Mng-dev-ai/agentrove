import { memo, useEffect, useLayoutEffect, useState } from 'react';
import type { ThemedToken } from '@pierre/diffs';
import { DIFF_SYNTAX_CSS } from '@/components/sandbox/git/DiffView/diffSyntaxTheme';
import { claim, createCodeHighlight, findReleased, firstLine, release } from './codeHighlight';
import type { CodeHighlight } from './codeHighlight';
import styles from './CodeBlock.module.scss';

const FRAME_BUDGET_MS = 4;

const CodeLine = memo(function CodeLine({ tokens, rest }: { tokens: ThemedToken[]; rest: string }) {
  return (
    <span className={styles['code-line']}>
      <span className={styles['code-content']}>
        {tokens.map((token, i) => (
          <span key={i} style={{ color: token.color }}>
            {token.content}
          </span>
        ))}
        {rest}
      </span>
    </span>
  );
});

interface HighlightedCodeProps {
  code: string;
  language: string;
}

export function HighlightedCode({ code, language }: HighlightedCodeProps) {
  const [highlight, setHighlight] = useState<CodeHighlight | null>(null);
  const [, setFrame] = useState(0);
  const highlighted = highlight?.feed(code, performance.now() + FRAME_BUDGET_MS) ?? null;
  const behind = highlighted !== null && highlighted.source.length < code.length;
  const head = firstLine(code);

  useLayoutEffect(() => {
    if (!highlight) return;
    claim(highlight);
    return () => release(highlight);
  }, [highlight]);

  useLayoutEffect(() => {
    if (highlight) return;
    const reused = findReleased(language, head);
    if (reused) {
      setHighlight(reused);
      return;
    }
    let live = true;
    createCodeHighlight(language).then((next) => {
      if (live) setHighlight(next);
      else next?.dispose();
    });
    return () => {
      live = false;
    };
  }, [highlight, language, head]);

  useEffect(() => {
    if (!behind) return;
    const frame = requestAnimationFrame(() => setFrame((n) => n + 1));
    return () => cancelAnimationFrame(frame);
  });

  const style = (
    <style href="diff-syntax-theme" precedence="default">
      {DIFF_SYNTAX_CSS}
    </style>
  );
  if (!highlighted) {
    return (
      <>
        {style}
        {code}
      </>
    );
  }
  const last = highlighted.lines.length - 1;
  return (
    <>
      {style}
      {highlighted.lines.map((tokens, i) => (
        <CodeLine
          key={i}
          tokens={tokens}
          rest={i < last ? '\n' : code.slice(highlighted.source.length)}
        />
      ))}
    </>
  );
}
