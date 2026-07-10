import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/utils/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from '@/utils/logger';
import { StreamContentBuffer, extractAssistantText, PROMPT_SUGGESTIONS_RE } from './stream';
import type { AssistantStreamEvent } from '@/types/chat.types';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PROMPT_SUGGESTIONS_RE', () => {
  it('strips a complete suggestions tag, including multiline content', () => {
    const input = 'a<prompt_suggestions>\n["x"]\n</prompt_suggestions>b';
    expect(input.replace(PROMPT_SUGGESTIONS_RE, '')).toBe('ab');
  });

  it('strips every occurrence (global flag)', () => {
    const input =
      '<prompt_suggestions>1</prompt_suggestions>x<prompt_suggestions>2</prompt_suggestions>';
    expect(input.replace(PROMPT_SUGGESTIONS_RE, '')).toBe('x');
  });

  it('leaves an unclosed tag in place (only complete tags match)', () => {
    const input = 'keep<prompt_suggestions>partial';
    expect(input.replace(PROMPT_SUGGESTIONS_RE, '')).toBe(input);
  });
});

describe('extractAssistantText — array source', () => {
  it('joins assistant_text events and ignores other kinds', () => {
    const events: AssistantStreamEvent[] = [
      { type: 'assistant_text', text: 'Hello ' },
      { type: 'assistant_thinking', thinking: 'ignored' },
      { type: 'user_text', text: 'ignored' },
      { type: 'assistant_text', text: 'world' },
    ];
    expect(extractAssistantText(events)).toBe('Hello world');
  });

  it('strips a trailing suggestions tag and trims trailing whitespace', () => {
    const events: AssistantStreamEvent[] = [
      { type: 'assistant_text', text: 'answer <prompt_suggestions>["a"]</prompt_suggestions>' },
    ];
    expect(extractAssistantText(events)).toBe('answer');
  });

  it('returns an empty string when there are no assistant_text events', () => {
    expect(extractAssistantText([{ type: 'assistant_thinking', thinking: 't' }])).toBe('');
  });
});

describe('extractAssistantText — string source', () => {
  it('wraps plain (non-JSON) content as a single assistant_text', () => {
    expect(extractAssistantText('just a message')).toBe('just a message');
  });

  it('parses a JSON event-array string', () => {
    const source = JSON.stringify([
      { type: 'assistant_text', text: 'a' },
      { type: 'assistant_text', text: 'b' },
    ]);
    expect(extractAssistantText(source)).toBe('ab');
  });

  it('returns an empty string for empty input', () => {
    expect(extractAssistantText('')).toBe('');
  });

  it('treats a JSON array that is not an event array as plain text', () => {
    // [1,2,3] parses but fails the event-array shape check -> wrapped as text.
    expect(extractAssistantText('[1,2,3]')).toBe('[1,2,3]');
  });

  it('treats malformed JSON as plain text and logs the parse failure', () => {
    expect(extractAssistantText('[not valid json')).toBe('[not valid json');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe('extractAssistantText — parse cache', () => {
  it('parses identical content only once (cache hit skips the reparse)', () => {
    const malformed = `[${'z'.repeat(200)}`;
    extractAssistantText(malformed);
    extractAssistantText(malformed);
    // A cache hit does not reparse, so the parse-failure log fires exactly once.
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('does not serve a false cache hit for distinct content', () => {
    extractAssistantText(`[${'a'.repeat(200)}`);
    extractAssistantText(`[${'b'.repeat(200)}`);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('keys long strings by fingerprint but guards against fingerprint collisions', () => {
    // Same length + first-50 + last-50, differing only in the middle -> same
    // cache key. The content-equality guard must still return each own result.
    const head = 'H'.repeat(50);
    const tail = 'T'.repeat(50);
    const a = head + 'A'.repeat(50) + tail;
    const b = head + 'B'.repeat(50) + tail;
    expect(extractAssistantText(a)).toBe(a);
    expect(extractAssistantText(b)).toBe(b);
  });

  it('evicts the oldest entry once the 20-entry cap is exceeded (FIFO)', () => {
    const sentinel = `[${'S'.repeat(200)}`;
    extractAssistantText(sentinel); // parse -> 1 log
    // 20 distinct long entries fully refill the capped cache, evicting sentinel.
    for (let i = 0; i < 20; i++) {
      extractAssistantText(`[evict${i}${'q'.repeat(200)}`);
    }
    extractAssistantText(sentinel); // evicted -> reparse -> +1 log
    expect(logger.error).toHaveBeenCalledTimes(22);
  });
});

describe('StreamContentBuffer', () => {
  it('starts empty', () => {
    const buf = new StreamContentBuffer();
    expect(buf.getEvents()).toEqual([]);
    expect(buf.getContentText()).toBe('');
    expect(buf.serialize()).toBe('[]');
    expect(buf.snapshot()).toEqual({ events: [] });
  });

  it('seeds text from initial assistant_text events', () => {
    const buf = new StreamContentBuffer([
      { type: 'assistant_text', text: 'foo' },
      { type: 'assistant_thinking', thinking: 'skip' },
      { type: 'assistant_text', text: 'bar' },
    ]);
    expect(buf.getContentText()).toBe('foobar');
  });

  it('prefers explicit initialText over reconstructing from events', () => {
    const buf = new StreamContentBuffer(
      [{ type: 'assistant_text', text: 'fromEvents' }],
      'fromText',
    );
    expect(buf.getContentText()).toBe('fromText');
  });

  it('accumulates pushed assistant_text into events and content', () => {
    const buf = new StreamContentBuffer();
    buf.push({ type: 'assistant_text', text: 'a' });
    buf.push({ type: 'assistant_text', text: 'b' });
    expect(buf.getContentText()).toBe('ab');
    expect(buf.getEvents()).toHaveLength(2);
  });

  it('records non-text events without changing the joined text', () => {
    const buf = new StreamContentBuffer();
    buf.push({ type: 'assistant_thinking', thinking: 'hmm' });
    expect(buf.getContentText()).toBe('');
    expect(buf.getEvents()).toHaveLength(1);
  });

  it('ignores empty assistant_text for the text buffer but still records the event', () => {
    const buf = new StreamContentBuffer();
    buf.push({ type: 'assistant_text', text: '' });
    expect(buf.getContentText()).toBe('');
    expect(buf.getEvents()).toHaveLength(1);
  });

  it('snapshot returns a copy that is decoupled from later pushes', () => {
    const buf = new StreamContentBuffer();
    buf.push({ type: 'assistant_text', text: 'a' });
    const snap = buf.snapshot();
    buf.push({ type: 'assistant_text', text: 'b' });
    expect(snap.events).toHaveLength(1);
  });

  it('serializes the events to JSON', () => {
    const buf = new StreamContentBuffer();
    buf.push({ type: 'assistant_text', text: 'hi' });
    expect(buf.serialize()).toBe(JSON.stringify([{ type: 'assistant_text', text: 'hi' }]));
  });

  it('does not mutate the caller-provided initialEvents array', () => {
    const initial: AssistantStreamEvent[] = [{ type: 'assistant_text', text: 'a' }];
    const buf = new StreamContentBuffer(initial);
    buf.push({ type: 'assistant_text', text: 'b' });
    expect(initial).toHaveLength(1);
  });
});
