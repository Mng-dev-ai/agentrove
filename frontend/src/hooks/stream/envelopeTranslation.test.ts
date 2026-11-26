import { describe, it, expect } from 'vitest';
import streamEnvelopes from '@/test/streamEnvelopes.json';
import { wireEnvelope } from '@/test/fixtures';
import type { StreamEnvelope } from '@/types/stream.types';
import { envelopeToRenderEvent } from './envelopeTranslation';

// Exhaustive over the union, so a kind added to StreamEnvelope has to be classified
// here; the fixture test below then demands an entry for it.
const RENDERS_CONTENT: Record<StreamEnvelope['kind'], boolean> = {
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

describe('envelopeToRenderEvent', () => {
  it('drops envelopes with nothing to render', () => {
    expect(
      envelopeToRenderEvent(wireEnvelope({ kind: 'assistant_text', payload: { text: '' } })),
    ).toBeNull();
    expect(envelopeToRenderEvent(wireEnvelope({ kind: 'tool_started', payload: {} }))).toBeNull();
    expect(
      envelopeToRenderEvent(wireEnvelope({ kind: 'plan', payload: { data: { entries: [] } } })),
    ).toBeNull();
    expect(
      envelopeToRenderEvent(wireEnvelope({ kind: 'complete', payload: { text: 'done' } })),
    ).toBeNull();
  });

  it('keeps only string prompt suggestions', () => {
    expect(
      envelopeToRenderEvent(
        wireEnvelope({ kind: 'prompt_suggestions', payload: { suggestions: ['Run tests', 3] } }),
      ),
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
      const envelope = wireEnvelope(entry);
      const event = envelopeToRenderEvent(envelope);
      if (RENDERS_CONTENT[envelope.kind]) {
        expect(event).toMatchObject({ type: entry.kind, ...entry.payload });
      } else {
        expect(event).toBeNull();
      }
    }
  });
});
