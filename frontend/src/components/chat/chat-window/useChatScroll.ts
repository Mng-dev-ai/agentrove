import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Message } from '@/types/chat.types';

const AT_BOTTOM_THRESHOLD_PX = 200;
const TOP_PAGINATION_TRIGGER_PX = 50;
const TOP_PAGINATION_ARM_VIEWPORT_MULTIPLIER = 1.5;

interface UseChatScrollParams {
  chatId: string | undefined;
  messages: Message[];
  pendingUserMessageId: string | null;
  latestUserMessageId: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

// Owns the message scroller's stick-to-bottom, top-pagination, and send-anchor
// behavior. Kept as a single hook so Chat can consume the refs/state without
// re-deriving the delicate scroll bookkeeping.
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
  // Send id whose anchor scroll hasn't run yet, and whether the animation is in flight
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

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const atBottom = distanceFromBottom <= AT_BOTTOM_THRESHOLD_PX;
    const isScrollingUp = lastScrollTopRef.current !== null && scrollTop < lastScrollTopRef.current;

    // Settle the anchor on reaching its target or on user up-scroll — not on atBottom,
    // which never arrives when the reply outgrows the spacer mid-flight.
    if (anchoringRef.current && (scrollTop >= anchorTargetRef.current - 1 || isScrollingUp)) {
      anchoringRef.current = false;
      setShowScrollButton(!atBottom);
    }

    if (isAtBottomRef.current !== atBottom) {
      isAtBottomRef.current = atBottom;
      setShowScrollButton(!atBottom && !anchoringRef.current);
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

  // Initial scroll to bottom when messages first load
  useEffect(() => {
    if (hasInitializedToBottomRef.current || messages.length === 0) return;

    const container = scrollerRef.current;
    if (!container) return;

    // Use requestAnimationFrame to ensure DOM has rendered
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
      hasInitializedToBottomRef.current = true;
    });
  }, [messages]);

  // Prepend anchoring: restore scroll position after older messages are prepended
  useLayoutEffect(() => {
    const prevHeight = prevScrollHeightRef.current;
    if (prevHeight === null) return;

    const container = scrollerRef.current;
    if (!container) return;

    container.scrollTop = container.scrollHeight - prevHeight;
    prevScrollHeightRef.current = null;
  }, [messages]);

  useLayoutEffect(() => {
    // Send anchor, step 1 of a two-commit handshake: reserve a viewport of space under
    // the new turn (the reply streams into it instead of growing the page); the state
    // commit re-fires step 2, which scrolls once the spacer exists in the DOM.
    if (!pendingUserMessageId || !scrollerRef.current) return;
    anchorTurnRef.current = pendingUserMessageId;
    setTurnMinHeight(scrollerRef.current.clientHeight);
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
        lastScrollTopRef.current = node.scrollTop;
        node.addEventListener('scroll', handleScroll, { passive: true });
        // Stick to bottom whenever the content grows while the user is anchored
        // there. Growth comes from stream flushes, the word-reveal animation
        // ticking between flushes, and late layout (images, KaTeX) — a
        // messages-keyed effect misses the latter two. ResizeObserver fires
        // after layout and before paint, so the scroll never lags the growth.
        // Skipped mid-anchor: an instant snap would cancel the send's smooth scroll.
        const content = node.firstElementChild;
        if (content) {
          const observer = new ResizeObserver(() => {
            if (isAtBottomRef.current && !anchoringRef.current) {
              node.scrollTop = node.scrollHeight;
            } else {
              // Content shrinking (e.g. collapsing a rollup) may leave scrollTop
              // unchanged so no scroll event fires — re-check at-bottom state or
              // the scroll button stays visible with nothing left to scroll.
              handleScroll();
            }
          });
          observer.observe(content);
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
