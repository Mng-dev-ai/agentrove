import { describe, it, expect } from 'vitest';
import {
  buildSegments,
  segmentsEqual,
  type MessageSegment,
  type ToolSegment,
} from './segmentBuilder';
import type { AssistantStreamEvent, PlanEntry } from '@/types/chat.types';
import type { ToolEventPayload } from '@/types/tools.types';

const toolPayload = (over: Partial<ToolEventPayload> & { id: string }): ToolEventPayload => ({
  name: 'Bash',
  title: 'run',
  status: 'started',
  ...over,
});

describe('buildSegments — text/thinking translation', () => {
  it.each([
    ['assistant_text', 'text', 'text-0'],
    ['user_text', 'text', 'text-0'],
    ['assistant_thinking', 'thinking', 'thinking-0'],
  ] as const)('batches consecutive %s events into one segment', (type, kind, id) => {
    const event = (chunk: string): AssistantStreamEvent =>
      type === 'assistant_thinking' ? { type, thinking: chunk } : { type, text: chunk };
    expect(buildSegments([event('foo '), event('bar')])).toEqual([{ kind, id, text: 'foo bar' }]);
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
    expect(segments).toHaveLength(1);
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
  it('flushes pending thinking and text before a tool and advances text ids around it', () => {
    const segments = buildSegments([
      { type: 'assistant_thinking', thinking: 'plan' },
      { type: 'assistant_text', text: 'before' },
      { type: 'tool_started', tool: toolPayload({ id: 't1' }) },
      { type: 'assistant_text', text: 'after' },
    ]);
    expect(segments.map((s) => s.id)).toEqual(['thinking-0', 'text-0', 'tool-t1', 'text-1']);
  });
});

describe('buildSegments — plan translation', () => {
  const entry = (content: string, status: PlanEntry['status'] = 'pending'): PlanEntry => ({
    content,
    status,
  });

  it('flushes pending text before emitting a plan segment', () => {
    const segments = buildSegments([
      { type: 'assistant_text', text: 'working' },
      { type: 'plan', data: { entries: [entry('a')] } },
    ]);
    expect(segments).toEqual([
      { kind: 'text', id: 'text-0', text: 'working' },
      { kind: 'plan', id: 'plan-0', entries: [entry('a')] },
    ]);
  });

  it('re-renders the plan at the current position when content arrives in between', () => {
    const first = [entry('a', 'in_progress')];
    const second = [entry('a', 'completed')];
    const segments = buildSegments([
      { type: 'plan', data: { entries: first } },
      { type: 'assistant_text', text: 'step done' },
      { type: 'plan', data: { entries: second } },
    ]);
    expect(segments).toEqual([
      { kind: 'plan', id: 'plan-0', entries: first },
      { kind: 'text', id: 'text-0', text: 'step done' },
      { kind: 'plan', id: 'plan-1', entries: second },
    ]);
  });

  it('collapses back-to-back plan snapshots into one segment', () => {
    const second = [entry('a', 'completed'), entry('b', 'in_progress')];
    const segments = buildSegments([
      { type: 'plan', data: { entries: [entry('a', 'completed')] } },
      { type: 'plan', data: { entries: second } },
    ]);
    expect(segments).toEqual([{ kind: 'plan', id: 'plan-0', entries: second }]);
  });

  it('ignores plan events with missing or empty entries', () => {
    expect(buildSegments([{ type: 'plan' }])).toEqual([]);
    expect(buildSegments([{ type: 'plan', data: { entries: [] } }])).toEqual([]);
  });
});

describe('segmentsEqual', () => {
  const events: AssistantStreamEvent[] = [
    { type: 'assistant_thinking', thinking: 'plan' },
    { type: 'tool_started', tool: toolPayload({ id: 'p', input: { a: 1 } }) },
    { type: 'tool_started', tool: toolPayload({ id: 'c', parent_id: 'p' }) },
    { type: 'plan', data: { entries: [{ content: 'a', status: 'pending' }] } },
    { type: 'assistant_text', text: 'answer' },
    { type: 'prompt_suggestions', suggestions: ['next'] },
  ];

  it('treats segments rebuilt from the same events as unchanged', () => {
    const before = buildSegments(events);
    const after = buildSegments(events);
    expect(before.map((segment, i) => segmentsEqual(segment, after[i]))).toEqual(
      before.map(() => true),
    );
  });

  it('flags only the segments a later event changed, including nested tool updates', () => {
    const before = buildSegments(events);
    const after = buildSegments([
      ...events,
      { type: 'tool_completed', tool: toolPayload({ id: 'c', status: 'completed', result: 'ok' }) },
      { type: 'assistant_text', text: ' more' },
    ]);
    const changed = before.filter((segment, i) => !segmentsEqual(segment, after[i]));
    expect(changed.map((segment) => segment.id)).toEqual(['tool-p']);
  });

  it('never equates segments whose id or kind differ', () => {
    const text: MessageSegment = { kind: 'text', id: 'x', text: 't' };
    expect(segmentsEqual(text, { ...text, id: 'y' })).toBe(false);
    expect(segmentsEqual(text, { kind: 'thinking', id: 'x', text: 't' })).toBe(false);
  });
});
