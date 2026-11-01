import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamContentBuffer, extractAssistantText, PROMPT_SUGGESTIONS_RE } from './stream';
import type { AssistantStreamEvent } from '@/types/chat.types';

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PROMPT_SUGGESTIONS_RE', () => {
  it('strips a complete suggestions tag, including multiline content', () => {
    const input = 'a<prompt_suggestions>\n["x"]\n</prompt_suggestions>b';
    expect(input.replace(PROMPT_SUGGESTIONS_RE, '')).toBe('ab');
  });

  it('strips every occurrence', () => {
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
    expect(extractAssistantText('[1,2,3]')).toBe('[1,2,3]');
  });

  it('treats malformed JSON as plain text and logs the parse failure', () => {
    expect(extractAssistantText('[not valid json')).toBe('[not valid json');
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});

describe('extractAssistantText — parse cache', () => {
  it('parses identical content only once', () => {
    const malformed = `[${'z'.repeat(200)}`;
    extractAssistantText(malformed);
    extractAssistantText(malformed);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('returns the right text for long strings that share a length, head and tail', () => {
    const head = 'H'.repeat(50);
    const tail = 'T'.repeat(50);
    const a = head + 'A'.repeat(50) + tail;
    const b = head + 'B'.repeat(50) + tail;
    expect(extractAssistantText(a)).toBe(a);
    expect(extractAssistantText(b)).toBe(b);
  });
});

describe('StreamContentBuffer', () => {
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

  it('merges adjacent same-type deltas and keeps boundaries between kinds', () => {
    const buf = new StreamContentBuffer([{ type: 'assistant_thinking', thinking: 'h' }]);
    buf.push({ type: 'assistant_thinking', thinking: 'mm' });
    buf.push({ type: 'assistant_text', text: 'a' });
    buf.push({ type: 'assistant_text', text: 'b' });
    expect(buf.getContentText()).toBe('ab');
    expect(buf.getEvents()).toEqual([
      { type: 'assistant_thinking', thinking: 'hmm' },
      { type: 'assistant_text', text: 'ab' },
    ]);
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
    expect(snap.events).toEqual([{ type: 'assistant_text', text: 'a' }]);
  });

  it('does not mutate the caller-provided initialEvents array', () => {
    const initial: AssistantStreamEvent[] = [{ type: 'assistant_text', text: 'a' }];
    const buf = new StreamContentBuffer(initial);
    buf.push({ type: 'assistant_text', text: 'b' });
    expect(initial).toHaveLength(1);
  });
});
