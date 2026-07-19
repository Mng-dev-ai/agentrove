import type { Options } from 'react-markdown';
import type { Element as HastElement, ElementContent, Root as HastRoot } from 'hast';
import type { MessageAttachment } from '@/types/chat.types';
import { buildHighlightSegments } from '@/utils/mentionParser';
import { MENTION_PILL_CLASSNAME } from '../shared/HighlightedText/HighlightedText';

export const MATH_PATTERN = /(^|[^\\])(\$[^$\n]+\$|\$\$[\s\S]*?\$\$|\\\(|\\\[)/;

// Unclosed ```visualizer at stream end — partial body for live preview.
const UNCLOSED_VISUALIZER_RE = /```visualizer\n([\s\S]*)$/;

// Opening fence only (no newline after "visualizer").
const OPENING_VISUALIZER_RE = /```visualizer$/;

const CLOSED_VISUALIZER_RE = /```visualizer\n([\s\S]*?)```/g;

// Safe to start a new block; indented/list/blockquote lines must stay attached.
const SAFE_BLOCK_START_RE = /^(?![ \t]|[-*+] |\d+[.)] |>)\S/;
// Fence marker + info string separate — closer must match opener, not any 3+ fence.
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

// Split md vs visualizer blocks; completed visualizers stay keyed outside react-markdown
// so streaming parent re-renders don't remount iframes.
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

  const unclosedMatch = remainder.match(UNCLOSED_VISUALIZER_RE);
  if (unclosedMatch) {
    const before = remainder.slice(0, unclosedMatch.index);
    if (before) segments.push({ type: 'md', content: before });
    if (unclosedMatch[1]) segments.push({ type: 'visualizer', content: unclosedMatch[1] });
  } else if (OPENING_VISUALIZER_RE.test(remainder)) {
    // Opening fence only — strip it from markdown
    const before = remainder.replace(OPENING_VISUALIZER_RE, '');
    if (before) segments.push({ type: 'md', content: before });
  } else {
    if (remainder) segments.push({ type: 'md', content: remainder });
  }

  return segments;
}

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

function buildMentionPillNodes(value: string): ElementContent[] | null {
  // null → caller keeps the original node (no tokens)
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
