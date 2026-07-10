import { describe, it, expect } from 'vitest';
import {
  buildSegments,
  segmentsEqual,
  type MessageSegment,
  type ToolSegment,
} from './segmentBuilder';
import type { AssistantStreamEvent } from '@/types/chat.types';
import type { ToolEventPayload } from '@/types/tools.types';

// Minimal tool payload factory — only the fields buildSegments reads.
const toolPayload = (over: Partial<ToolEventPayload> & { id: string }): ToolEventPayload => ({
  name: 'Bash',
  title: 'run',
  status: 'started',
  ...over,
});

const toolSegments = (segments: MessageSegment[]): ToolSegment[] =>
  segments.filter((s): s is ToolSegment => s.kind === 'tool');

describe('buildSegments — text/thinking translation', () => {
  it('returns an empty array for no events', () => {
    expect(buildSegments([])).toEqual([]);
  });

  it('emits a single text segment for one assistant_text', () => {
    const segments = buildSegments([{ type: 'assistant_text', text: 'hello' }]);
    expect(segments).toEqual([{ kind: 'text', id: 'text-0', text: 'hello' }]);
  });

  it('batches consecutive assistant_text events into one segment', () => {
    const segments = buildSegments([
      { type: 'assistant_text', text: 'foo ' },
      { type: 'assistant_text', text: 'bar' },
    ]);
    expect(segments).toEqual([{ kind: 'text', id: 'text-0', text: 'foo bar' }]);
  });

  it('drops empty assistant_text (nothing accumulated to flush)', () => {
    expect(buildSegments([{ type: 'assistant_text', text: '' }])).toEqual([]);
  });

  it('interleaves thinking and text, flushing on kind switch', () => {
    const segments = buildSegments([
      { type: 'assistant_thinking', thinking: 'ponder' },
      { type: 'assistant_text', text: 'answer' },
      { type: 'assistant_thinking', thinking: 'more' },
    ]);
    expect(segments).toEqual([
      { kind: 'thinking', id: 'thinking-0', text: 'ponder' },
      { kind: 'text', id: 'text-0', text: 'answer' },
      { kind: 'thinking', id: 'thinking-1', text: 'more' },
    ]);
  });

  it('batches consecutive thinking events into one segment', () => {
    const segments = buildSegments([
      { type: 'assistant_thinking', thinking: 'a' },
      { type: 'assistant_thinking', thinking: 'b' },
    ]);
    expect(segments).toEqual([{ kind: 'thinking', id: 'thinking-0', text: 'ab' }]);
  });

  it('merges user_text into the same pending-text buffer as assistant_text', () => {
    // Current behavior: user_text shares the pendingText buffer, so adjacent
    // assistant/user text collapse into one segment (see suspicion note).
    const segments = buildSegments([
      { type: 'assistant_text', text: 'A' },
      { type: 'user_text', text: 'B' },
    ]);
    expect(segments).toEqual([{ kind: 'text', id: 'text-0', text: 'AB' }]);
  });
});

describe('buildSegments — prompt suggestions', () => {
  it('emits a suggestions segment from a prompt_suggestions event', () => {
    const segments = buildSegments([
      { type: 'assistant_text', text: 'done' },
      { type: 'prompt_suggestions', suggestions: ['a', 'b'] },
    ]);
    expect(segments).toEqual([
      { kind: 'text', id: 'text-0', text: 'done' },
      { kind: 'suggestions', id: 'suggestions-0', suggestions: ['a', 'b'] },
    ]);
  });

  it('strips a complete inline <prompt_suggestions> tag from text', () => {
    const segments = buildSegments([
      { type: 'assistant_text', text: 'Reply <prompt_suggestions>["x"]</prompt_suggestions>' },
    ]);
    expect(segments).toEqual([{ kind: 'text', id: 'text-0', text: 'Reply' }]);
  });

  it('strips a partial (unclosed) prompt_suggestions tag from text', () => {
    const segments = buildSegments([
      { type: 'assistant_text', text: 'Reply<prompt_suggestions>["x' },
    ]);
    expect(segments).toEqual([{ kind: 'text', id: 'text-0', text: 'Reply' }]);
  });

  it('drops a text segment that is only a suggestions tag, keeping ids sequential', () => {
    const segments = buildSegments([
      { type: 'assistant_text', text: '<prompt_suggestions>["x"]</prompt_suggestions>' },
      { type: 'assistant_thinking', thinking: 't' },
      { type: 'assistant_text', text: 'real' },
    ]);
    // First flush yields empty -> no segment, count not advanced, so real text is text-0.
    expect(segments).toEqual([
      { kind: 'thinking', id: 'thinking-0', text: 't' },
      { kind: 'text', id: 'text-0', text: 'real' },
    ]);
  });
});

describe('buildSegments — tool translation', () => {
  it('creates a root tool segment for a started tool', () => {
    const segments = buildSegments([
      { type: 'tool_started', tool: toolPayload({ id: 't1', name: 'Read' }) },
    ]);
    expect(segments).toEqual([
      {
        kind: 'tool',
        id: 'tool-t1',
        tool: {
          id: 't1',
          name: 'Read',
          title: 'run',
          status: 'started',
          parentId: null,
          input: null,
          result: undefined,
          error: undefined,
          children: [],
        },
      },
    ]);
  });

  it('updates the same segment when a tool completes (no duplicate)', () => {
    const segments = buildSegments([
      { type: 'tool_started', tool: toolPayload({ id: 't1' }) },
      {
        type: 'tool_completed',
        tool: toolPayload({ id: 't1', status: 'completed', result: 'ok' }),
      },
    ]);
    expect(segments).toHaveLength(1);
    const tool = (segments[0] as ToolSegment).tool;
    expect(tool.status).toBe('completed');
    expect(tool.result).toBe('ok');
  });

  it('captures error and failed status on tool_failed', () => {
    const segments = buildSegments([
      { type: 'tool_started', tool: toolPayload({ id: 't1' }) },
      {
        type: 'tool_failed',
        tool: toolPayload({ id: 't1', status: 'failed', error: 'boom' }),
      },
    ]);
    const tool = (segments[0] as ToolSegment).tool;
    expect(tool.status).toBe('failed');
    expect(tool.error).toBe('boom');
  });

  it('preserves prior input/title when a completion omits them', () => {
    const segments = buildSegments([
      {
        type: 'tool_started',
        tool: toolPayload({ id: 't1', title: 'Original', input: { a: 1 } }),
      },
      {
        type: 'tool_completed',
        // name/title empty and input absent -> keep the started values.
        tool: { id: 't1', name: '', title: '', status: 'completed' },
      },
    ]);
    const tool = (segments[0] as ToolSegment).tool;
    expect(tool.title).toBe('Original');
    expect(tool.input).toEqual({ a: 1 });
    expect(tool.name).toBe('Bash');
    expect(tool.status).toBe('completed');
  });

  it('nests a child under a parent that arrived first', () => {
    const segments = buildSegments([
      { type: 'tool_started', tool: toolPayload({ id: 'parent' }) },
      { type: 'tool_started', tool: toolPayload({ id: 'child', parent_id: 'parent' }) },
    ]);
    // Only the parent is a root segment; the child lives in its children.
    expect(toolSegments(segments)).toHaveLength(1);
    const parent = (segments[0] as ToolSegment).tool;
    expect(parent.id).toBe('parent');
    expect(parent.children.map((c) => c.id)).toEqual(['child']);
    expect(parent.children[0].parentId).toBe('parent');
  });

  it('attaches an out-of-order child that arrived before its parent', () => {
    const segments = buildSegments([
      { type: 'tool_started', tool: toolPayload({ id: 'child', parent_id: 'parent' }) },
      { type: 'tool_started', tool: toolPayload({ id: 'parent' }) },
    ]);
    // Child must not become a root segment; it is queued then attached on parent arrival.
    expect(segments).toHaveLength(1);
    const parent = (segments[0] as ToolSegment).tool;
    expect(parent.id).toBe('parent');
    expect(parent.children.map((c) => c.id)).toEqual(['child']);
  });

  it('reparents a root tool to a new parent when parent_id appears mid-stream', () => {
    const segments = buildSegments([
      { type: 'tool_started', tool: toolPayload({ id: 'parent' }) },
      { type: 'tool_started', tool: toolPayload({ id: 'child' }) },
      {
        type: 'tool_completed',
        tool: toolPayload({ id: 'child', status: 'completed', parent_id: 'parent' }),
      },
    ]);
    // Child was a root segment, then moved under parent — root now holds only parent.
    expect(segments).toHaveLength(1);
    const parent = (segments[0] as ToolSegment).tool;
    expect(parent.id).toBe('parent');
    expect(parent.children.map((c) => c.id)).toEqual(['child']);
    expect(parent.children[0].status).toBe('completed');
  });

  it('propagates a nested grandchild update up the parent chain', () => {
    const segments = buildSegments([
      { type: 'tool_started', tool: toolPayload({ id: 'p' }) },
      { type: 'tool_started', tool: toolPayload({ id: 'c', parent_id: 'p' }) },
      { type: 'tool_started', tool: toolPayload({ id: 'g', parent_id: 'c' }) },
      {
        type: 'tool_completed',
        tool: toolPayload({ id: 'g', status: 'completed', parent_id: 'c', result: 'r' }),
      },
    ]);
    const p = (segments[0] as ToolSegment).tool;
    const g = p.children[0].children[0];
    expect(g.id).toBe('g');
    expect(g.status).toBe('completed');
    expect(g.result).toBe('r');
  });
});

describe('buildSegments — ordering across kinds', () => {
  it('preserves emission order and advances text ids around a tool', () => {
    const events: AssistantStreamEvent[] = [
      { type: 'assistant_text', text: 'before' },
      { type: 'tool_started', tool: toolPayload({ id: 't1' }) },
      { type: 'assistant_text', text: 'after' },
    ];
    const segments = buildSegments(events);
    expect(segments.map((s) => s.kind)).toEqual(['text', 'tool', 'text']);
    expect((segments[0] as { id: string }).id).toBe('text-0');
    expect((segments[2] as { id: string }).id).toBe('text-1');
  });

  it('flushes pending text and thinking before a tool segment', () => {
    const segments = buildSegments([
      { type: 'assistant_thinking', thinking: 'plan' },
      { type: 'assistant_text', text: 'note' },
      { type: 'tool_started', tool: toolPayload({ id: 't1' }) },
    ]);
    expect(segments.map((s) => s.kind)).toEqual(['thinking', 'text', 'tool']);
  });
});

describe('segmentsEqual', () => {
  it('returns false for differing ids', () => {
    const a: MessageSegment = { kind: 'text', id: 'text-0', text: 'x' };
    const b: MessageSegment = { kind: 'text', id: 'text-1', text: 'x' };
    expect(segmentsEqual(a, b)).toBe(false);
  });

  it('compares text content when ids match', () => {
    const a: MessageSegment = { kind: 'text', id: 'text-0', text: 'x' };
    const b: MessageSegment = { kind: 'text', id: 'text-0', text: 'y' };
    expect(segmentsEqual(a, { ...a })).toBe(true);
    expect(segmentsEqual(a, b)).toBe(false);
  });

  it('compares suggestions by reference identity', () => {
    const list = ['a'];
    const a: MessageSegment = { kind: 'suggestions', id: 's-0', suggestions: list };
    expect(segmentsEqual(a, { kind: 'suggestions', id: 's-0', suggestions: list })).toBe(true);
    expect(segmentsEqual(a, { kind: 'suggestions', id: 's-0', suggestions: ['a'] })).toBe(false);
  });

  it('returns false when kinds differ despite matching ids', () => {
    const a: MessageSegment = { kind: 'text', id: 'x', text: 't' };
    const b: MessageSegment = { kind: 'thinking', id: 'x', text: 't' };
    expect(segmentsEqual(a, b)).toBe(false);
  });
});
