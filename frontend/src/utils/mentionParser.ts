export interface HighlightSegment {
  text: string;
  isToken: boolean;
}

// Leading /command token on the first line. Looser than useSlashCommandSuggestions'
// trigger (which requires the whole first line to be spaceless) — only the token pills.
const COMMAND_TOKEN_REGEX = /^([^\S\n]*)(\/\S+)/;
// @path preceded by start-of-string or whitespace — mirrors parseMentionQuery's boundary rule.
// Paths containing spaces truncate at the space, same as the unquoted mention insertion.
const MENTION_TOKEN_REGEX = /(^|\s)(@\S+)/g;

interface MentionParseResult {
  isActive: boolean;
  query: string;
  mentionStartPos: number;
  mentionEndPos: number;
}

const INACTIVE_RESULT: MentionParseResult = {
  isActive: false,
  query: '',
  mentionStartPos: -1,
  mentionEndPos: -1,
} as const;

export const parseMentionQuery = (message: string, cursorPosition: number): MentionParseResult => {
  const textBeforeCursor = message.slice(0, cursorPosition);
  const lastAtIndex = textBeforeCursor.lastIndexOf('@');

  if (lastAtIndex === -1) {
    return INACTIVE_RESULT;
  }

  const charBeforeAt = lastAtIndex > 0 ? message[lastAtIndex - 1] : ' ';
  const isValidStart = charBeforeAt === ' ' || charBeforeAt === '\n' || lastAtIndex === 0;

  if (!isValidStart) {
    return INACTIVE_RESULT;
  }

  const textAfterAt = message.slice(lastAtIndex + 1, cursorPosition);

  if (textAfterAt.includes(' ') || textAfterAt.includes('\n')) {
    return INACTIVE_RESULT;
  }

  return {
    isActive: true,
    query: textAfterAt.toLowerCase(),
    mentionStartPos: lastAtIndex,
    mentionEndPos: cursorPosition,
  };
};

export const getHighlightTokenRanges = (
  message: string,
  allowCommand = true,
): Array<[number, number]> => {
  // [start, end) offsets of @file mentions and the leading /command.
  // allowCommand=false for text fragments that don't start at the message head.
  const tokenRanges: Array<[number, number]> = [];

  const commandMatch = allowCommand ? COMMAND_TOKEN_REGEX.exec(message) : null;
  if (commandMatch) {
    const start = commandMatch[1].length;
    tokenRanges.push([start, start + commandMatch[2].length]);
  }

  for (const match of message.matchAll(MENTION_TOKEN_REGEX)) {
    const start = match.index + match[1].length;
    tokenRanges.push([start, start + match[2].length]);
  }

  return tokenRanges;
};

export const buildHighlightSegments = (
  message: string,
  allowCommand = true,
): HighlightSegment[] => {
  // Split text into plain/token runs so callers can render pills behind the
  // tokens without altering the raw value.
  const tokenRanges = getHighlightTokenRanges(message, allowCommand);

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
