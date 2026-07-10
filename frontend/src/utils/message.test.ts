import { describe, it, expect, vi } from 'vitest';
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
    expect(att.file_url).toMatch(/^blob:/);
  });

  it('produces an empty attachments array for an empty file list', () => {
    expect(createInitialMessage('p', [], 'm', 'c').attachments).toEqual([]);
  });
});

describe('createAttachmentsFromFiles', () => {
  it('returns undefined for null or empty input', () => {
    const store = vi.fn();
    expect(createAttachmentsFromFiles(null, store)).toBeUndefined();
    expect(createAttachmentsFromFiles([], store)).toBeUndefined();
    expect(store).not.toHaveBeenCalled();
  });

  it('maps files to attachments and stores the blob url only for pdfs', () => {
    const store = vi.fn();
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    const pdf = new File(['y'], 'b.pdf', { type: 'application/pdf' });
    const atts = createAttachmentsFromFiles([png, pdf], store);

    expect(atts).toHaveLength(2);
    expect(atts?.[0].file_type).toBe('image');
    expect(atts?.[1].file_type).toBe('pdf');
    expect(atts?.[1].file_url).toMatch(/^blob:/);
    // storeBlobUrl fires for the pdf only, with the file and its blob url.
    expect(store).toHaveBeenCalledTimes(1);
    expect(store).toHaveBeenCalledWith(pdf, atts?.[1].file_url);
    // message_id is a millisecond timestamp string.
    expect(atts?.[0].message_id).toMatch(/^\d+$/);
  });
});
