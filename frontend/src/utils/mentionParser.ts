export interface HighlightSegment {
  text: string;
  isToken: boolean;
}

// Boundary rule mirrors parseTokenQuery so suggestion inserts also pill.
// Paths with spaces truncate at the space (same as unquoted insertion).
const TOKEN_REGEX = /(^|\s)([@/]\S+)/g;

interface TokenQueryResult {
  isActive: boolean;
  query: string;
  tokenStartPos: number;
  tokenEndPos: number;
}

const INACTIVE_RESULT: TokenQueryResult = {
  isActive: false,
  query: '',
  tokenStartPos: -1,
  tokenEndPos: -1,
} as const;

export const parseTokenQuery = (
  message: string,
  cursorPosition: number,
  trigger: '@' | '/',
): TokenQueryResult => {
  const textBeforeCursor = message.slice(0, cursorPosition);
  const lastTriggerIndex = textBeforeCursor.lastIndexOf(trigger);

  if (lastTriggerIndex === -1) {
    return INACTIVE_RESULT;
  }

  const charBeforeTrigger = lastTriggerIndex > 0 ? message[lastTriggerIndex - 1] : ' ';
  const isValidStart =
    charBeforeTrigger === ' ' || charBeforeTrigger === '\n' || lastTriggerIndex === 0;

  if (!isValidStart) {
    return INACTIVE_RESULT;
  }

  const textAfterTrigger = message.slice(lastTriggerIndex + 1, cursorPosition);

  if (textAfterTrigger.includes(' ') || textAfterTrigger.includes('\n')) {
    return INACTIVE_RESULT;
  }

  return {
    isActive: true,
    query: textAfterTrigger.toLowerCase(),
    tokenStartPos: lastTriggerIndex,
    tokenEndPos: cursorPosition,
  };
};

export const insertToken = (
  message: string,
  token: string,
  startPos: number,
  endPos: number,
): { text: string; cursor: number } => {
  // Trailing space closes the suggestion query so the panel dismisses.
  const before = message.slice(0, startPos);
  const after = message.slice(endPos);
  const separator = after.startsWith(' ') ? '' : ' ';
  return {
    text: `${before}${token}${separator}${after}`,
    cursor: before.length + token.length + separator.length,
  };
};

export const getHighlightTokenRanges = (message: string): Array<[number, number]> => {
  const tokenRanges: Array<[number, number]> = [];

  for (const match of message.matchAll(TOKEN_REGEX)) {
    const start = match.index + match[1].length;
    tokenRanges.push([start, start + match[2].length]);
  }

  return tokenRanges;
};

export const buildHighlightSegments = (message: string): HighlightSegment[] => {
  // Plain/token runs so callers can render pills without altering the raw value.
  const tokenRanges = getHighlightTokenRanges(message);

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of tokenRanges) {
    if (start > cursor) {
      segments.push({ text: message.slice(cursor, start), isToken: false });
    }
    segments.push({ text: message.slice(start, end), isToken: true });
    cursor = end;
  }
  if (cursor < message.length) {
    segments.push({ text: message.slice(cursor), isToken: false });
  }
  return segments;
};
