import { logger } from '@/utils/logger';

const REOPEN_DELAY_MS = 15_000;

// Chat lifecycle SSE: EventSource retries transients but treats HTTP errors
// (e.g. expired query-param token) as fatal CLOSED — reopen via createSource.
// No server-side replay, so successful open after any failure calls onResync.
export function subscribeChatEventsFeed(options: {
  createSource: () => Promise<EventSource>;
  onChatEvent: (event: MessageEvent) => void;
  onResync: () => void;
  logContext: string;
}): () => void {
  const { createSource, onChatEvent, onResync, logContext } = options;
  let source: EventSource | undefined;
  let cancelled = false;
  let retryTimer: number | undefined;
  let needsResync = false;

  const scheduleReopen = () => {
    if (cancelled) return;
    retryTimer = window.setTimeout(openFeed, REOPEN_DELAY_MS);
  };

  const openFeed = () => {
    createSource()
      .then((eventSource) => {
        if (cancelled) {
          eventSource.close();
          return;
        }
        source = eventSource;
        // Custom event names hit the generic EventTarget overload, which takes Event.
        source.addEventListener('chat_event', (event: Event) => onChatEvent(event as MessageEvent));
        source.onopen = () => {
          if (needsResync) {
            needsResync = false;
            onResync();
          }
        };
        source.onerror = () => {
          // Gaps include transient drops retried natively (never hit CLOSED).
          needsResync = true;
          if (source?.readyState !== EventSource.CLOSED) return;
          scheduleReopen();
        };
      })
      .catch((error: unknown) => {
        logger.error('Chat events stream failed to open', logContext, error);
        needsResync = true;
        scheduleReopen();
      });
  };

  openFeed();

  return () => {
    cancelled = true;
    window.clearTimeout(retryTimer);
    source?.close();
  };
}
