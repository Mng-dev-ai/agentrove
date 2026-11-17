import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ThemedToken } from '@pierre/diffs';
import {
  createCodeHighlight,
  firstLine,
  loadedCodeHighlight,
  release,
  takeReleased,
} from './codeHighlight';
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
  const owned = useRef<CodeHighlight | null>(null);
  const [, setFrame] = useState(0);
  const highlighted = highlight?.feed(code, performance.now() + FRAME_BUDGET_MS) ?? null;
  const behind = highlighted !== null && highlighted.source.length < code.length;
  const head = firstLine(code);

  useLayoutEffect(
    () => () => {
      if (owned.current) release(owned.current);
      owned.current = null;
    },
    [],
  );

  useLayoutEffect(() => {
    if (owned.current) return;
    const ready = takeReleased(language, head) ?? loadedCodeHighlight(language);
    if (ready) {
      owned.current = ready;
      setHighlight(ready);
      return;
    }
    let live = true;
    createCodeHighlight(language).then((next) => {
      if (!live) {
        next?.dispose();
      } else if (next) {
        owned.current = next;
        setHighlight(next);
      }
    });
    return () => {
      live = false;
    };
  }, [language, head]);

  useEffect(() => {
    if (!behind) return;
    const frame = requestAnimationFrame(() => setFrame((n) => n + 1));
    return () => cancelAnimationFrame(frame);
  });

  if (!highlighted) return code;
  const last = highlighted.lines.length - 1;
  return highlighted.lines.map((tokens, i) => (
    <CodeLine
      key={i}
      tokens={tokens}
      rest={i < last ? '\n' : code.slice(highlighted.source.length)}
    />
  ));
}
