import { buildHighlightSegments } from '@/utils/mentionParser';

// Canonical pill look for @mention / /command tokens. Also consumed by
// MarkDown's rehype transform, which builds hast nodes and can't render
// this component — so it's a global class (defined in styles/app.scss),
// not a CSS module.
export const MENTION_PILL_CLASSNAME = 'mention-pill';

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
