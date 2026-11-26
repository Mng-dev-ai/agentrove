import type { AssistantStreamEvent } from '@/types/chat.types';
import type { StreamEnvelope } from '@/types/stream.types';

// Content-bearing kinds only; system/permission_request are handled in onEnvelope.
export function envelopeToRenderEvent(envelope: StreamEnvelope): AssistantStreamEvent | null {
  switch (envelope.kind) {
    case 'user_steering': {
      const { payload } = envelope;
      return {
        type: 'user_steering',
        queued_message_id: payload.queued_message_id,
        text: payload.text,
        attachments: payload.attachments,
        app_notice: payload.app_notice === true,
      };
    }
    case 'assistant_text': {
      const { payload } = envelope;
      const text = typeof payload.text === 'string' ? payload.text : '';
      if (!text) return null;
      return { type: 'assistant_text', text };
    }
    case 'assistant_thinking': {
      const { payload } = envelope;
      const thinking = typeof payload.thinking === 'string' ? payload.thinking : '';
      if (!thinking) return null;
      return { type: 'assistant_thinking', thinking };
    }
    case 'tool_started':
    case 'tool_completed':
    case 'tool_failed': {
      const { payload } = envelope;
      if (!payload.tool || typeof payload.tool !== 'object') {
        return null;
      }
      return { type: envelope.kind, tool: payload.tool };
    }
    case 'prompt_suggestions': {
      const raw = envelope.payload.suggestions;
      if (!Array.isArray(raw)) return null;
      const suggestions = raw.filter((item): item is string => typeof item === 'string');
      if (suggestions.length === 0) return null;
      return { type: 'prompt_suggestions', suggestions };
    }
    case 'plan': {
      const entries = envelope.payload.data?.entries;
      if (!Array.isArray(entries) || entries.length === 0) return null;
      return { type: 'plan', data: { entries } };
    }
    default:
      return null;
  }
}
