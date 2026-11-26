import { describe, it, expect } from 'vitest';
import streamEnvelopes from '@/test/streamEnvelopes.json';
import type { StreamEnvelope, StreamKind } from '@/types/stream.types';
import { envelopeToRenderEvent } from './envelopeTranslation';

// Exhaustive over the union, so a kind added to StreamEnvelope has to be classified
// here; the fixture test below then demands an entry for it.
const RENDERS_CONTENT: Record<StreamKind, boolean> = {
  stream_started: false,
  assistant_text: true,
  assistant_thinking: true,
  tool_started: true,
  tool_completed: true,
  tool_failed: true,
  user_text: false,
  user_steering: true,
  system: false,
  permission_request: false,
  permission_resolved: false,
  permission_dismissed: false,
  elicitation_request: false,
  elicitation_resolved: false,
  elicitation_dismissed: false,
  prompt_suggestions: true,
  plan: true,
  complete: false,
  cancelled: false,
  error: false,
  queue_processing: false,
};

// Wire data is unvalidated JSON, so payloads the types rule out still arrive.
const fromWire = (value: unknown): StreamEnvelope => JSON.parse(JSON.stringify(value));

const wireEnvelope = (kind: StreamKind, payload: unknown): StreamEnvelope =>
  fromWire({ chatId: 'c1', messageId: 'a1', streamId: 's1', seq: 1, kind, payload });

describe('envelopeToRenderEvent', () => {
  it('drops envelopes with nothing to render', () => {
    expect(envelopeToRenderEvent(wireEnvelope('assistant_text', { text: '' }))).toBeNull();
    expect(envelopeToRenderEvent(wireEnvelope('tool_started', {}))).toBeNull();
    expect(envelopeToRenderEvent(wireEnvelope('plan', { data: { entries: [] } }))).toBeNull();
    expect(envelopeToRenderEvent(wireEnvelope('complete', { text: 'done' }))).toBeNull();
  });

  it('keeps only string prompt suggestions', () => {
    expect(
      envelopeToRenderEvent(wireEnvelope('prompt_suggestions', { suggestions: ['Run tests', 3] })),
    ).toEqual({ type: 'prompt_suggestions', suggestions: ['Run tests'] });
  });
});

// backend/tests/test_stream_envelopes.py holds StreamEnvelopeKind to the same file.
describe('backend stream envelope fixture', () => {
  it('has an entry for exactly the kinds in the StreamEnvelope union', () => {
    expect([...new Set(streamEnvelopes.map((entry) => entry.kind))].sort()).toEqual(
      Object.keys(RENDERS_CONTENT).sort(),
    );
  });

  it('translates each content kind to the render event the backend persists', () => {
    for (const entry of streamEnvelopes) {
      const envelope = fromWire(entry);
      const event = envelopeToRenderEvent(envelope);
      if (RENDERS_CONTENT[envelope.kind]) {
        expect(event).toMatchObject({ type: entry.kind, ...entry.payload });
      } else {
        expect(event).toBeNull();
      }
    }
  });
});
