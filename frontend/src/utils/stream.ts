import type { AssistantStreamEvent } from '@/types/chat.types';
import { logger } from '@/utils/logger';

function isAssistantStreamEventArray(value: unknown): value is AssistantStreamEvent[] {
  return (
    Array.isArray(value) &&
    value.every((item) => item && typeof item === 'object' && 'type' in item)
  );
}

interface ParseCacheEntry {
  content: string;
  events: AssistantStreamEvent[];
}

// Avoid re-parsing content_text each render. Long keys fingerprint length+ends.
const PARSE_CACHE_MAX_SIZE = 20;
const parseCache = new Map<string, ParseCacheEntry>();

function getContentKey(content: string): string {
  return content.length > 100
    ? `${content.length}:${content.slice(0, 50)}:${content.slice(-50)}`
    : content;
}

// "[" → JSON event array; otherwise plain text (legacy) as one assistant_text.
function parseEventLogUncached(content: string): AssistantStreamEvent[] {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  if (!trimmed.startsWith('[')) {
    return [
      {
        type: 'assistant_text',
        text: content,
      },
    ];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (isAssistantStreamEventArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    logger.error('Message event dispatch failed', 'stream', error);
  }

  return [
    {
      type: 'assistant_text',
      text: content,
    },
  ];
}

const parseEventLog = (content: string | null | undefined): AssistantStreamEvent[] => {
  if (!content) {
    return [];
  }

  const cacheKey = getContentKey(content);
  const cached = parseCache.get(cacheKey);

  if (cached && cached.content === content) {
    return cached.events;
  }

  const events = parseEventLogUncached(content);

  if (parseCache.size >= PARSE_CACHE_MAX_SIZE) {
    const firstKey = parseCache.keys().next().value;
    if (firstKey) parseCache.delete(firstKey);
  }
  parseCache.set(cacheKey, { content, events });

  return events;
};

export interface ContentRenderSnapshot {
  events?: AssistantStreamEvent[];
}

// Parallel textParts so getContentText() is a join, not an events scan.
// Seeded on reconnect so resumed streams append rather than restart.
export class StreamContentBuffer {
  private events: AssistantStreamEvent[];
  private textParts: string[];

  constructor(initialEvents: AssistantStreamEvent[] = [], initialText = '') {
    this.events = [...initialEvents];
    this.textParts = [];

    if (initialText) {
      this.textParts.push(initialText);
    } else if (initialEvents.length > 0) {
      for (const event of initialEvents) {
        if (event.type === 'assistant_text' && event.text) {
          this.textParts.push(event.text);
        }
      }
    }
  }

  push(event: AssistantStreamEvent): void {
    this.events.push(event);
    if (event.type === 'assistant_text' && event.text) {
      this.textParts.push(event.text);
    }
  }

  getEvents(): AssistantStreamEvent[] {
    return this.events;
  }

  getContentText(): string {
    return this.textParts.join('');
  }

  snapshot(): ContentRenderSnapshot {
    return { events: [...this.events] };
  }

  serialize(): string {
    return JSON.stringify(this.events);
  }
}

export const PROMPT_SUGGESTIONS_RE = /<prompt_suggestions>[\s\S]*?<\/prompt_suggestions>/g;

export const extractAssistantText = (source: string | AssistantStreamEvent[]): string => {
  const events = Array.isArray(source) ? source : parseEventLog(source);
  const raw = events
    .filter((event) => event.type === 'assistant_text')
    .map((event) => event.text)
    .join('');
  return raw.replace(PROMPT_SUGGESTIONS_RE, '').trimEnd();
};
