import { buildHighlightSegments } from '@/utils/mentionParser';

// Canonical pill look for @mention / /command tokens. Also consumed by
// MarkDown's rehype transform, which builds hast nodes and can't render
// this component.
// TODO(refactor): consumed by MarkDown rehype as a raw class string; can't be a CSS module
export const MENTION_PILL_CLASSNAME =
  'rounded bg-surface-active box-decoration-clone px-1 py-0.5 text-text-primary dark:bg-surface-dark-active dark:text-text-dark-primary';

interface HighlightedTextProps {
  text: string;
  // Override for layers that must not repaint glyphs (the input's transparent backdrop).
  tokenClassName?: string;
}

export function HighlightedText({
  text,
  tokenClassName = MENTION_PILL_CLASSNAME,
}: HighlightedTextProps) {
  return (
    <>
      {buildHighlightSegments(text).map((segment, index) =>
        segment.isToken ? (
          <span key={index} className={tokenClassName}>
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
