import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

const AT_BOTTOM_THRESHOLD_PX = 200;
const TOP_PAGINATION_TRIGGER_PX = 50;
const TOP_PAGINATION_ARM_VIEWPORT_MULTIPLIER = 1.5;

// Clamped: rubber-band overscroll reports positions outside the scroll range.
function clampedScrollTop(node: HTMLElement) {
  return Math.min(Math.max(node.scrollTop, 0), node.scrollHeight - node.clientHeight);
}

// Every instant write moves the direction baseline with it, or a user scroll coalesced
// into the same scroll event would be measured from the pre-write position.
function writeScrollTop(
  node: HTMLElement,
  top: number,
  lastScrollTopRef: { current: number | null },
) {
  node.scrollTop = top;
  lastScrollTopRef.current = clampedScrollTop(node);
}

// Net of the content's bottom padding, so the anchored turn top is exactly max scroll.
function reservedTurnHeight(scroller: HTMLElement, content: Element) {
  return scroller.clientHeight - parseFloat(getComputedStyle(content).paddingBottom);
}

interface UseChatScrollParams {
  chatId: string | undefined;
  messages: readonly unknown[];
  pendingUserMessageId: string | null;
  latestUserMessageId: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

// Stick-to-bottom, top-pagination, and send-anchor for the message scroller.
export function useChatScroll({
  chatId,
  messages,
  pendingUserMessageId,
  latestUserMessageId,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: UseChatScrollParams) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const hasInitializedToBottomRef = useRef(false);
  const topPaginationArmedRef = useRef(false);
  const lastScrollTopRef = useRef<number | null>(null);
  const isAtBottomRef = useRef(true);
  const prevScrollHeightRef = useRef<number | null>(null);
  const prevChatIdForScrollRef = useRef(chatId);

  const [showScrollButton, setShowScrollButton] = useState(false);

  const turnRef = useRef<HTMLDivElement | null>(null);
  const anchorTurnRef = useRef<string | null>(null);
  const anchoringRef = useRef(false);
  const anchorTargetRef = useRef(0);
  const [turnMinHeight, setTurnMinHeight] = useState(0);

  if (prevChatIdForScrollRef.current !== chatId) {
    prevChatIdForScrollRef.current = chatId;
    hasInitializedToBottomRef.current = false;
    topPaginationArmedRef.current = false;
    lastScrollTopRef.current = null;
    isAtBottomRef.current = true;
    prevScrollHeightRef.current = null;
    anchorTurnRef.current = null;
    anchoringRef.current = false;
    setTurnMinHeight(0);
    setShowScrollButton(false);
  }

  const fetchNextPageRef = useRef(fetchNextPage);
  const hasNextPageRef = useRef(hasNextPage);
  const isFetchingNextPageRef = useRef(isFetchingNextPage);
  fetchNextPageRef.current = fetchNextPage;
  hasNextPageRef.current = hasNextPage;
  isFetchingNextPageRef.current = isFetchingNextPage;

  const handleScroll = useCallback(() => {
    const container = scrollerRef.current;
    if (!container) return;

    const { scrollHeight, clientHeight } = container;
    const scrollTop = clampedScrollTop(container);
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const lastScrollTop = lastScrollTopRef.current;
    // Fractional scrollTop at non-integer device pixel ratios jitters by under a pixel.
    const isScrollingUp = lastScrollTop !== null && lastScrollTop - scrollTop >= 1;
    const isScrollingDown = lastScrollTop !== null && scrollTop > lastScrollTop;
    // Direction, not distance, decides: any up-scroll leaves the bottom and only scrolling
    // down near it (or reaching it) returns. Distance alone would misread content that
    // grew past the threshold (stream end, the send's reserve) as the reader leaving, and
    // a small up-scroll within it as staying. Content shrinking clamps scrollTop down too,
    // but leaves the reader at max scroll.
    const atBottom = isAtBottomRef.current
      ? !isScrollingUp || distanceFromBottom <= 1
      : distanceFromBottom <= 1 ||
        (isScrollingDown && distanceFromBottom <= AT_BOTTOM_THRESHOLD_PX);

    // Settle the anchor on reaching its target or on user up-scroll — not on atBottom,
    // which never arrives when the reply outgrows the spacer mid-flight.
    if (anchoringRef.current && (scrollTop >= anchorTargetRef.current - 1 || isScrollingUp)) {
      anchoringRef.current = false;
      // An instant write stops the smooth scroll, whose remaining downward steps would
      // otherwise re-pin the reader who just scrolled up.
      if (isScrollingUp) writeScrollTop(container, scrollTop, lastScrollTopRef);
    }

    if (isAtBottomRef.current !== atBottom) {
      isAtBottomRef.current = atBottom;
      setShowScrollButton(!atBottom);
    }

    if (atBottom) {
      hasInitializedToBottomRef.current = true;
    }

    if (!hasInitializedToBottomRef.current) {
      lastScrollTopRef.current = scrollTop;
      return;
    }

    const isNearTop = scrollTop <= clientHeight * TOP_PAGINATION_ARM_VIEWPORT_MULTIPLIER;

    if (!topPaginationArmedRef.current && isScrollingUp && isNearTop) {
      topPaginationArmedRef.current = true;
    }

    if (
      topPaginationArmedRef.current &&
      scrollTop < TOP_PAGINATION_TRIGGER_PX &&
      hasNextPageRef.current &&
      !isFetchingNextPageRef.current &&
      fetchNextPageRef.current
    ) {
      topPaginationArmedRef.current = false;
      prevScrollHeightRef.current = container.scrollHeight;
      void fetchNextPageRef.current();
    }

    lastScrollTopRef.current = scrollTop;
  }, []);

  useEffect(() => {
    if (hasInitializedToBottomRef.current || messages.length === 0) return;

    const container = scrollerRef.current;
    if (!container) return;

    // rAF so layout has committed before measuring scrollHeight.
    const raf = requestAnimationFrame(() => {
      writeScrollTop(container, container.scrollHeight, lastScrollTopRef);
      hasInitializedToBottomRef.current = true;
    });
    // Cancel so a chat switch or unmount can't let the stale frame scroll the
    // old container and mark the new chat as already initialized.
    return () => cancelAnimationFrame(raf);
  }, [messages]);

  // Keep viewport stable when older pages prepend above the fold.
  useLayoutEffect(() => {
    const prevHeight = prevScrollHeightRef.current;
    if (prevHeight === null) return;

    const container = scrollerRef.current;
    if (!container) return;

    writeScrollTop(container, container.scrollHeight - prevHeight, lastScrollTopRef);
    prevScrollHeightRef.current = null;
  }, [messages]);

  useLayoutEffect(() => {
    // Send anchor, step 1 of a two-commit handshake: reserve a viewport of space under
    // the new turn (the reply streams into it instead of growing the page); the state
    // commit re-fires step 2, which scrolls once the spacer exists in the DOM.
    const scroller = scrollerRef.current;
    if (!pendingUserMessageId || !scroller?.firstElementChild) return;
    anchorTurnRef.current = pendingUserMessageId;
    // Sending takes the reader to the new turn, wherever they had scrolled to.
    isAtBottomRef.current = true;
    setShowScrollButton(false);
    setTurnMinHeight(reservedTurnHeight(scroller, scroller.firstElementChild));
  }, [pendingUserMessageId]);

  useLayoutEffect(() => {
    // Send anchor, step 2: one smooth scroll pinning the sent message to the top.
    if (!anchorTurnRef.current) return;
    if (anchorTurnRef.current !== pendingUserMessageId) {
      // Send rolled back (optimistic message removed) before the anchor ran
      anchorTurnRef.current = null;
      return;
    }
    const scroller = scrollerRef.current;
    const turn = turnRef.current;
    if (!scroller || !turn) return;
    const top =
      turn.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    // Spacer not committed yet — scrolling now would clamp short; the min-height
    // state update from step 1 re-runs this effect in the next commit.
    if (top + scroller.clientHeight > scroller.scrollHeight + 1) return;
    anchorTurnRef.current = null;
    // Already at the target (first message in a short chat): no scroll event would
    // ever fire to settle the latch, so don't arm it — there's nothing to animate.
    if (Math.abs(top - scroller.scrollTop) <= 1) return;
    anchoringRef.current = true;
    anchorTargetRef.current = top;
    // Exact turn top == max scroll with the spacer, so later stick-to-bottom
    // snaps land on the same pixel instead of correcting a decorative offset.
    scroller.scrollTo({ top, behavior: 'smooth' });
  }, [pendingUserMessageId, turnMinHeight]);

  const scrollToBottom = useCallback(() => {
    setShowScrollButton(false);
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' });
  }, []);

  const contentResizeObserverRef = useRef<ResizeObserver | null>(null);

  const containerRefCallback = useCallback(
    (node: HTMLDivElement | null) => {
      const prev = scrollerRef.current;
      if (prev) {
        prev.removeEventListener('scroll', handleScroll);
      }
      contentResizeObserverRef.current?.disconnect();
      contentResizeObserverRef.current = null;
      scrollerRef.current = node;
      if (node) {
        lastScrollTopRef.current = clampedScrollTop(node);
        node.addEventListener('scroll', handleScroll, { passive: true });
        // Stick to bottom whenever the content grows while the user is anchored
        // there. Growth comes from stream flushes, the word-reveal animation
        // ticking between flushes, and late layout (images, KaTeX) — a
        // messages-keyed effect misses the latter two. ResizeObserver fires
        // after layout and before paint, so the scroll never lags the growth.
        // Skipped mid-anchor: an instant snap would cancel the send's smooth scroll.
        const content = node.firstElementChild;
        if (content) {
          let height = node.clientHeight;
          const observer = new ResizeObserver(() => {
            // The reserve tracks the viewport height (window resize, mobile keyboard);
            // committed synchronously so the snap below lands before paint. Height only:
            // a sync commit while a panel animates the width loops this observer in WebKit.
            if (node.clientHeight !== height) {
              height = node.clientHeight;
              flushSync(() =>
                setTurnMinHeight((height) => height && reservedTurnHeight(node, content)),
              );
            }
            // Settles a user scroll whose event hasn't fired yet before the snap would
            // overwrite it; also re-checks at-bottom when shrinking content (a collapsed
            // rollup) leaves scrollTop unchanged so no scroll event fires.
            handleScroll();
            if (isAtBottomRef.current && !anchoringRef.current) {
              writeScrollTop(node, node.scrollHeight, lastScrollTopRef);
            }
          });
          observer.observe(content);
          observer.observe(node);
          contentResizeObserverRef.current = observer;
        }
      }
    },
    [handleScroll],
  );

  const prevPendingUserMessageIdRef = useRef(pendingUserMessageId);
  useLayoutEffect(() => {
    // A failed send clears the pending id AND removes its optimistic message (normal
    // clears keep the row) — drop the reserved space too, or the prior turn keeps a
    // viewport-tall blank spacer until the next send.
    const prevPending = prevPendingUserMessageIdRef.current;
    prevPendingUserMessageIdRef.current = pendingUserMessageId;
    if (prevPending === null || pendingUserMessageId !== null) return;
    if (latestUserMessageId !== prevPending) {
      anchoringRef.current = false;
      setTurnMinHeight(0);
    }
  }, [pendingUserMessageId, latestUserMessageId]);

  return {
    scrollerRef,
    turnRef,
    turnMinHeight,
    showScrollButton,
    containerRefCallback,
    scrollToBottom,
  };
}
