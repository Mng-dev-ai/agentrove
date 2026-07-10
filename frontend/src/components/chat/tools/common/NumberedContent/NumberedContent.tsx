import { memo, useMemo } from 'react';
import styles from './NumberedContent.module.scss';

interface NumberedContentProps {
  content: string;
  // When provided, capture group 1 supplies the displayed line number and the
  // full match is stripped from the rendered content. Lets us reuse the same
  // gutter renderer for agents whose read output already embeds line numbers
  // (Claude: "N→" / "N\t", Copilot-via-Claude: "N. ") alongside raw content.
  prefixPattern?: RegExp;
}

interface ParsedLine {
  lineNum: string;
  text: string;
}

export const NumberedContent = memo(function NumberedContent({
  content,
  prefixPattern,
}: NumberedContentProps) {
  const lines = useMemo<ParsedLine[]>(
    () =>
      content.split('\n').map((line, idx) => {
        if (prefixPattern) {
          const match = line.match(prefixPattern);
          if (match) return { lineNum: match[1], text: line.slice(match[0].length) };
        }
        return { lineNum: String(idx + 1), text: line };
      }),
    [content, prefixPattern],
  );

  return (
    <div className={styles.numbered}>
      {lines.map((line, idx) => (
        <div key={idx} className={styles.line}>
          <span className={styles.gutter}>{line.lineNum}</span>
          <span className={styles.text}>{line.text || ' '}</span>
        </div>
      ))}
    </div>
  );
});
