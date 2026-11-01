import { describe, it, expect } from 'vitest';
import type { StreamEnvelope, StreamKind } from '@/types/stream.types';
import { envelopeToRenderEvent } from './envelopeTranslation';

const envelope = (kind: StreamKind, payload: Record<string, unknown>): StreamEnvelope => ({
  chatId: 'c1',
  messageId: 'a1',
  streamId: 's1',
  seq: 1,
  kind,
  payload,
});

describe('envelopeToRenderEvent', () => {
  it('drops envelopes with nothing to render', () => {
    expect(envelopeToRenderEvent(envelope('assistant_text', { text: '' }))).toBeNull();
    expect(envelopeToRenderEvent(envelope('tool_started', {}))).toBeNull();
    expect(envelopeToRenderEvent(envelope('plan', { data: { entries: [] } }))).toBeNull();
    expect(envelopeToRenderEvent(envelope('complete', { text: 'done' }))).toBeNull();
  });

  it('keeps only string prompt suggestions', () => {
    expect(
      envelopeToRenderEvent(envelope('prompt_suggestions', { suggestions: ['Run tests', 3] })),
    ).toEqual({ type: 'prompt_suggestions', suggestions: ['Run tests'] });
  });
});
