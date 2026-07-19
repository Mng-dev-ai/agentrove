import type { AssistantStreamEvent, PlanEntry } from '@/types/chat.types';
import type { ToolEventPayload } from '@/types/tools.types';
import type { StreamEnvelope } from '@/types/stream.types';

export function extractPayloadData(
  payload: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return payload.data && typeof payload.data === 'object'
    ? (payload.data as Record<string, unknown>)
    : undefined;
}

// Content-bearing kinds only; system/permission_request are handled in onEnvelope.
export function envelopeToRenderEvent(envelope: StreamEnvelope): AssistantStreamEvent | null {
  const payload = envelope.payload as Record<string, unknown>;

  switch (envelope.kind) {
    case 'assistant_text': {
      const text = typeof payload.text === 'string' ? payload.text : '';
      if (!text) return null;
      return { type: 'assistant_text', text };
    }
    case 'assistant_thinking': {
      const thinking = typeof payload.thinking === 'string' ? payload.thinking : '';
      if (!thinking) return null;
      return { type: 'assistant_thinking', thinking };
    }
    case 'tool_started':
    case 'tool_completed':
    case 'tool_failed': {
      if (!payload.tool || typeof payload.tool !== 'object') {
        return null;
      }
      return {
        type: envelope.kind,
        tool: payload.tool as ToolEventPayload,
      } as AssistantStreamEvent;
    }
    case 'prompt_suggestions': {
      const raw = payload.suggestions;
      if (!Array.isArray(raw)) return null;
      const suggestions = raw.filter((item): item is string => typeof item === 'string');
      if (suggestions.length === 0) return null;
      return { type: 'prompt_suggestions', suggestions };
    }
    case 'plan': {
      const entries = extractPayloadData(payload)?.entries;
      if (!Array.isArray(entries) || entries.length === 0) return null;
      return { type: 'plan', data: { entries: entries as PlanEntry[] } };
    }
    default:
      return null;
  }
}
