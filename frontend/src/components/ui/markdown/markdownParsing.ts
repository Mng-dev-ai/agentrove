import type { Element as HastElement, ElementContent, Root as HastRoot } from 'hast';
import type { MessageAttachment } from '@/types/chat.types';
import { buildHighlightSegments, type HighlightSegment } from '@/utils/mentionParser';
import { MENTION_PILL_CLASSNAME } from '../shared/HighlightedText/HighlightedText';

export const MATH_PATTERN = /(^|[^\\])(\$\$[\s\S]*?\$\$|\\\(|\\\[)/;

// Safe to start a new block; indented/list/blockquote lines must stay attached.
const SAFE_BLOCK_START_RE = /^(?![ \t]|[-*+] |\d+[.)] |>)\S/;
const MENTION_TRAILING_PUNCTUATION = '.,:;!?';
// Fence marker + info string separate — closer must match opener, not any 3+ fence.
const CODE_FENCE_LINE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
const MATH_FENCE_LINE_RE = /^\s*\$\$\s*$/;

export const createImageAttachment = (url: string, alt?: string): MessageAttachment => {
  return {
    id: url,
    file_url: url,
    file_type: 'image',
    filename: url.split('/').pop() || alt || 'image.jpg',
    message_id: '',
    created_at: '',
  };
};

// Chunk at blank lines outside fences so streaming keeps completed blocks byte-identical
// (memo skips re-parse). Isolation breaks cross-block refs — only use while streaming.
export function splitMarkdownBlocks(md: string): string[] {
  const lines = md.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let openFence: string | null = null;
  let inMathFence = false;
  let pendingBlanks = 0;

  for (const line of lines) {
    if (!openFence && !inMathFence && line.trim() === '') {
      if (current.length > 0) pendingBlanks++;
      continue;
    }
    if (pendingBlanks > 0) {
      if (SAFE_BLOCK_START_RE.test(line)) {
        blocks.push(current.join('\n'));
        current = [];
      } else {
        // Blank lines inside a loose list / continuation must be preserved
        for (let i = 0; i < pendingBlanks; i++) current.push('');
      }
      pendingBlanks = 0;
    }
    current.push(line);
    const fence = inMathFence ? null : CODE_FENCE_LINE_RE.exec(line);
    if (fence) {
      if (!openFence) {
        openFence = fence[1];
      } else if (
        // Per CommonMark, a closing fence uses the same character, is at least
        // as long as the opener, and has no info string — so ``` examples
        // inside a ```` fence don't end the block early.
        fence[1][0] === openFence[0] &&
        fence[1].length >= openFence.length &&
        fence[2].trim() === ''
      ) {
        openFence = null;
      }
    } else if (!openFence && MATH_FENCE_LINE_RE.test(line)) {
      inMathFence = !inMathFence;
    }
  }
  if (current.length > 0) blocks.push(current.join('\n'));
  return blocks;
}

// Mirrors the backend's channel mention resolution: case-insensitive name,
// trailing punctuation stripped until a member matches.
function memberMentionSegments(token: string, handles: ReadonlySet<string>): HighlightSegment[] {
  if (!token.startsWith('@')) return [{ text: token, isToken: false }];
  let name = token.slice(1);
  while (
    name &&
    !handles.has(name.toLowerCase()) &&
    MENTION_TRAILING_PUNCTUATION.includes(name.slice(-1))
  ) {
    name = name.slice(0, -1);
  }
  if (!name || !handles.has(name.toLowerCase())) return [{ text: token, isToken: false }];
  const rest = token.slice(name.length + 1);
  return [{ text: `@${name}`, isToken: true }, ...(rest ? [{ text: rest, isToken: false }] : [])];
}

function buildMentionPillNodes(
  value: string,
  handles: ReadonlySet<string> | undefined,
): ElementContent[] | null {
  // null → caller keeps the original node (no tokens)
  let segments = buildHighlightSegments(value);
  if (handles) {
    segments = segments.flatMap((segment) =>
      segment.isToken ? memberMentionSegments(segment.text, handles) : [segment],
    );
  }
  if (!segments.some((segment) => segment.isToken)) return null;
  return segments.map((segment) =>
    segment.isToken
      ? {
          type: 'element',
          tagName: 'span',
          properties: { className: MENTION_PILL_CLASSNAME },
          children: [{ type: 'text', value: segment.text }],
        }
      : { type: 'text', value: segment.text },
  );
}

function walkMentionPills(
  node: HastRoot | HastElement,
  handles: ReadonlySet<string> | undefined,
): void {
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === 'text') {
      const replacement = buildMentionPillNodes(child.value, handles);
      if (replacement) {
        children.splice(i, 1, ...replacement);
        i += replacement.length - 1;
      }
    } else if (child.type === 'element' && child.tagName !== 'code' && child.tagName !== 'pre') {
      walkMentionPills(child, handles);
    }
  }
}

// Wraps @file mention and /command tokens of user-authored messages in pill
// spans, matching the input box's token highlighting. Code spans/blocks are
// skipped so pasted snippets (e.g. Python decorators) aren't restyled. Given
// lowercased channel member handles, only `@member` mentions are wrapped: agent
// text is full of `@` that are not mentions.
export const rehypeMentionPills = (handles?: ReadonlySet<string>) => {
  return (tree: HastRoot) => {
    walkMentionPills(tree, handles);
  };
};
