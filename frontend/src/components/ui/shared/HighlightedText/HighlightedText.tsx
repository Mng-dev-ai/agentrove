import { buildHighlightSegments } from '@/utils/mentionParser';

// Global class (styles/app.scss) so MarkDown's hast transform can reuse it.
export const MENTION_PILL_CLASSNAME = 'mention-pill';

interface HighlightedTextProps {
  text: string;
  // Input backdrop overrides this (its styles are CSS-module scoped).
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
