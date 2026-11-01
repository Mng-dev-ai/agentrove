import { describe, it, expect } from 'vitest';
import { makeMessage } from '@/test/fixtures';
import { StreamProcessingError } from '@/types/stream.types';
import { buildFailedMessageUpdate } from './messageUpdates';

const partial = makeMessage('a1', {
  content_text: 'Partial answer',
  content_render: { events: [{ type: 'assistant_text', text: 'Partial answer' }] },
  last_seq: 4,
  active_stream_id: 's1',
  model_id: 'm',
});

describe('buildFailedMessageUpdate', () => {
  it('keeps streamed content, appends the error, and ends the stream as failed', () => {
    const failed = buildFailedMessageUpdate(new Error('Rate limited'))(partial);

    expect(failed).toMatchObject({
      content_text: 'Partial answer',
      active_stream_id: null,
      stream_status: 'failed',
    });
    expect(failed.content_render.events).toEqual([
      { type: 'assistant_text', text: 'Partial answer' },
      { type: 'assistant_text', text: '\n\nError: Rate limited' },
    ]);
  });

  it('surfaces the underlying cause of a processing error and uses it as text for an empty reply', () => {
    const error = new StreamProcessingError('Stream failed', new Error('Sandbox unreachable'));

    const failed = buildFailedMessageUpdate(error)({
      ...partial,
      content_text: '',
      content_render: { events: [] },
    });

    expect(failed.content_text).toBe('Sandbox unreachable');
    expect(failed.content_render.events).toEqual([
      { type: 'assistant_text', text: '\n\nError: Sandbox unreachable' },
    ]);
  });
});
