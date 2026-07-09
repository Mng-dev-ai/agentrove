import type { Options } from 'react-markdown';
import type { Element as HastElement, ElementContent, Root as HastRoot } from 'hast';
import type { MessageAttachment } from '@/types/chat.types';
import { buildHighlightSegments } from '@/utils/mentionParser';
import { MENTION_PILL_CLASSNAME } from '../shared/HighlightedText/HighlightedText';

export const MATH_PATTERN = /(^|[^\\])(\$[^$\n]+\$|\$\$[\s\S]*?\$\$|\\\(|\\\[)/;

// Matches an unclosed ```visualizer block at the end of streaming content.
// Captures the partial content so it can be rendered as a live preview.
const UNCLOSED_VISUALIZER_RE = /```visualizer\n([\s\S]*)$/;

// Matches just the opening fence without any content yet (no newline after "visualizer").
const OPENING_VISUALIZER_RE = /```visualizer$/;

// Matches a complete ```visualizer ... ``` block.
const CLOSED_VISUALIZER_RE = /```visualizer\n([\s\S]*?)```/g;

// Matches a line that can safely start a new markdown block. Indented lines,
// list items, and blockquote lines must stay attached to the previous block —
// splitting a loose list or nested content would change how it renders.
const SAFE_BLOCK_START_RE = /^(?![ \t]|[-*+] |\d+[.)] |>)\S/;
// Captures the fence marker and any trailing info string separately — closing
// a fence requires matching the opening marker, not just any 3+ fence chars.
const CODE_FENCE_LINE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
const MATH_FENCE_LINE_RE = /^\s*\$\$\s*$/;

export type MarkdownSegment = { type: 'md' | 'visualizer'; content: string };

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

// Split content into segments: markdown text and visualizer blocks.
// Completed blocks are rendered with stable keys outside react-markdown so they
// survive parent re-renders during streaming without iframe remount.
// Unclosed visualizer fences (still streaming) are rendered as live previews.
export function splitVisualizerBlocks(raw: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let lastIndex = 0;

  for (const match of raw.matchAll(CLOSED_VISUALIZER_RE)) {
    const before = raw.slice(lastIndex, match.index);
    if (before) segments.push({ type: 'md', content: before });
    segments.push({ type: 'visualizer', content: match[1] });
    lastIndex = match.index! + match[0].length;
  }

  const remainder = raw.slice(lastIndex);

  // Check for an unclosed visualizer fence with partial content (live preview)
  const unclosedMatch = remainder.match(UNCLOSED_VISUALIZER_RE);
  if (unclosedMatch) {
    const before = remainder.slice(0, unclosedMatch.index);
    if (before) segments.push({ type: 'md', content: before });
    if (unclosedMatch[1]) segments.push({ type: 'visualizer', content: unclosedMatch[1] });
  } else if (OPENING_VISUALIZER_RE.test(remainder)) {
    // Just the opening fence, no content yet — strip it from markdown
    const before = remainder.replace(OPENING_VISUALIZER_RE, '');
    if (before) segments.push({ type: 'md', content: before });
  } else {
    if (remainder) segments.push({ type: 'md', content: remainder });
  }

  return segments;
}

// Split markdown into block-level chunks at blank lines outside code/math
// fences. Streaming only appends text, so completed chunks stay byte-identical
// across flushes and their memoized renderers skip re-parsing entirely.
// Blocks parse in isolation, breaking cross-block reference links/footnotes —
// so this only runs on actively streaming content; static renders and the
// final parse at stream end get full document semantics.
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

function buildMentionPillNodes(value: string): ElementContent[] | null {
  // Null when the text holds no tokens so the caller can keep the original node.
  const segments = buildHighlightSegments(value);
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

function walkMentionPills(node: HastRoot | HastElement): void {
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === 'text') {
      const replacement = buildMentionPillNodes(child.value);
      if (replacement) {
        children.splice(i, 1, ...replacement);
        i += replacement.length - 1;
      }
    } else if (child.type === 'element' && child.tagName !== 'code' && child.tagName !== 'pre') {
      walkMentionPills(child);
    }
  }
}

// Wraps @file mention and /command tokens of user-authored messages in pill
// spans, matching the input box's token highlighting. Code spans/blocks are
// skipped so pasted snippets (e.g. Python decorators) aren't restyled.
export const rehypeMentionPills: NonNullable<Options['rehypePlugins']>[number] = () => {
  return (tree: HastRoot) => {
    walkMentionPills(tree);
  };
};
