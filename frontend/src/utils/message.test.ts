import { describe, it, expect } from 'vitest';
import type { Message } from '@/types/chat.types';
import { isAssistantMessage, createInitialMessage, createAttachmentsFromFiles } from './message';

const msg = (over: Partial<Message>): Message => ({
  id: 'm1',
  chat_id: 'c1',
  content_text: '',
  content_render: { events: [] },
  last_seq: 0,
  active_stream_id: null,
  stream_status: 'completed',
  role: 'assistant',
  attachments: [],
  model_id: null,
  duration_ms: null,
  created_at: '2020-01-01T00:00:00.000Z',
  checkpoint_id: null,
  tool_results_omitted: false,
  ...over,
});

describe('isAssistantMessage', () => {
  it('trusts is_bot=true regardless of role', () => {
    expect(isAssistantMessage(msg({ is_bot: true, role: 'user' }))).toBe(true);
  });

  it('trusts is_bot=false regardless of role (assistant role does not override)', () => {
    expect(isAssistantMessage(msg({ is_bot: false, role: 'assistant' }))).toBe(false);
  });

  it('falls back to the role when is_bot is undefined', () => {
    expect(isAssistantMessage(msg({ is_bot: undefined, role: 'assistant' }))).toBe(true);
    expect(isAssistantMessage(msg({ is_bot: undefined, role: 'user' }))).toBe(false);
  });
});

describe('createInitialMessage', () => {
  it('builds a completed user message seeded with a user_text event', () => {
    const m = createInitialMessage('hello', null, 'model-x', 'chat-1');
    expect(m.content_text).toBe('hello');
    expect(m.content_render.events).toEqual([{ type: 'user_text', text: 'hello' }]);
    expect(m.role).toBe('user');
    expect(m.is_bot).toBe(false);
    expect(m.stream_status).toBe('completed');
    expect(m.model_id).toBe('model-x');
    expect(m.chat_id).toBe('chat-1');
    expect(m.attachments).toEqual([]);
    expect(typeof m.id).toBe('string');
  });

  it('maps attached files into typed attachments', () => {
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    const m = createInitialMessage('with file', [file], 'model-x', 'chat-1');
    expect(m.attachments).toHaveLength(1);
    const [att] = m.attachments;
    expect(att.filename).toBe('shot.png');
    expect(att.file_type).toBe('image');
    expect(att.file_url).toBe(file);
  });

  it('produces an empty attachments array for an empty file list', () => {
    expect(createInitialMessage('p', [], 'm', 'c').attachments).toEqual([]);
  });
});

describe('createAttachmentsFromFiles', () => {
  it('returns undefined for null or empty input', () => {
    expect(createAttachmentsFromFiles(null)).toBeUndefined();
    expect(createAttachmentsFromFiles([])).toBeUndefined();
  });

  it('maps files to attachments without creating blob urls', () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    const pdf = new File(['y'], 'b.pdf', { type: 'application/pdf' });
    const atts = createAttachmentsFromFiles([png, pdf]);

    expect(atts).toHaveLength(2);
    expect(atts?.[0].file_type).toBe('image');
    expect(atts?.[1].file_type).toBe('pdf');
    expect(atts?.[0].file_url).toBe(png);
    expect(atts?.[1].file_url).toBe(pdf);
    // message_id is a millisecond timestamp string.
    expect(atts?.[0].message_id).toMatch(/^\d+$/);
  });
});
