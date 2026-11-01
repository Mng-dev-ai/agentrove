import { describe, it, expect } from 'vitest';
import { makeMessage } from '@/test/fixtures';
import { isAssistantMessage, createInitialMessage, createAttachmentsFromFiles } from './message';

describe('isAssistantMessage', () => {
  it('trusts is_bot=true regardless of role', () => {
    expect(isAssistantMessage(makeMessage('m1', { is_bot: true, role: 'user' }))).toBe(true);
  });

  it('trusts is_bot=false regardless of role (assistant role does not override)', () => {
    expect(isAssistantMessage(makeMessage('m1', { is_bot: false, role: 'assistant' }))).toBe(false);
  });

  it('falls back to the role when is_bot is undefined', () => {
    expect(isAssistantMessage(makeMessage('m1', { is_bot: undefined, role: 'assistant' }))).toBe(
      true,
    );
    expect(isAssistantMessage(makeMessage('m1', { is_bot: undefined, role: 'user' }))).toBe(false);
  });
});

describe('createInitialMessage', () => {
  it('builds a completed user message seeded with a user_text event', () => {
    const m = createInitialMessage('hello', null, 'model-x', 'chat-1');
    expect(m).toMatchObject({
      chat_id: 'chat-1',
      content_text: 'hello',
      content_render: { events: [{ type: 'user_text', text: 'hello' }] },
      role: 'user',
      stream_status: 'completed',
      model_id: 'model-x',
      attachments: [],
    });
    expect(isAssistantMessage(m)).toBe(false);
  });

  it('attaches the provided files', () => {
    const file = new File(['x'], 'shot.png', { type: 'image/png' });
    const m = createInitialMessage('with file', [file], 'model-x', 'chat-1');
    expect(m.attachments).toMatchObject([
      { filename: 'shot.png', file_type: 'image', file_url: file },
    ]);
  });
});

describe('createAttachmentsFromFiles', () => {
  it('returns undefined for null or empty input', () => {
    expect(createAttachmentsFromFiles(null)).toBeUndefined();
    expect(createAttachmentsFromFiles([])).toBeUndefined();
  });

  it('types each file and keeps the File itself as the url (no blob urls)', () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    const pdf = new File(['y'], 'b.pdf', { type: 'application/pdf' });
    expect(createAttachmentsFromFiles([png, pdf])).toMatchObject([
      { filename: 'a.png', file_type: 'image', file_url: png },
      { filename: 'b.pdf', file_type: 'pdf', file_url: pdf },
    ]);
  });
});
