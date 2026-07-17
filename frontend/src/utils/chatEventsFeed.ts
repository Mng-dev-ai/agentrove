import { logger } from '@/utils/logger';

const REOPEN_DELAY_MS = 15_000;

// Keeps a per-user chat lifecycle SSE feed alive. EventSource retries transient
// drops itself but treats HTTP errors as fatal (readyState CLOSED) — e.g. a 401
// once the query-param token expires — so fatal closes reopen with a freshly
// minted token via `createSource`. The backend feed is a pub/sub relay with no
// replay, so events published during a gap are gone: any successful open that
// follows a failure (native retry, fatal-close reopen, or a failed first
// attempt) calls `onResync` so the subscriber can refetch what it missed.
// Returns a cleanup that cancels retries and closes the feed.
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
          // Any error marks a potential gap — including transient drops the
          // EventSource retries natively without reaching the CLOSED branch.
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
