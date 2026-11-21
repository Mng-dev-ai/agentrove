import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

const AT_BOTTOM_THRESHOLD_PX = 200;
const TOP_PAGINATION_TRIGGER_PX = 50;
const TOP_PAGINATION_ARM_VIEWPORT_MULTIPLIER = 1.5;
const MESSAGE_ROW = '[data-message-id]';

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

// While pinned the hook is the scroll anchor. Native anchoring would answer content
// collapsing above the fold by scrolling up, which reads as the reader leaving the bottom.
function setAtBottom(
  node: HTMLElement | null,
  isAtBottomRef: { current: boolean },
  atBottom: boolean,
) {
  isAtBottomRef.current = atBottom;
  if (node) node.style.overflowAnchor = atBottom ? 'none' : '';
}

// The message to hold in place when a commit changes the head of the list (an older page
// prepended, the oldest messages dropped by a refetch): the first one from the top of the
// viewport down that is still in the list.
export function headAnchorId(
  renderedIds: readonly string[],
  nextIds: readonly string[],
  firstVisibleIndex: number,
): string | null {
  if (renderedIds.length === 0 || firstVisibleIndex < 0 || renderedIds[0] === nextIds[0]) {
    return null;
  }
  const kept = new Set(nextIds);
  return renderedIds.slice(firstVisibleIndex).find((id) => kept.has(id)) ?? null;
}

function messageRow(scroller: HTMLElement, id: string) {
  return scroller.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
}

// The message content stacked down the viewport, each element as deep as the tree goes at
// its edge: what native scroll anchoring picks from, in order.
function elementsInView(scroller: HTMLElement) {
  const viewport = scroller.getBoundingClientRect();
  const found: { element: Element; top: number }[] = [];
  let edge = viewport.top;
  while (edge < viewport.bottom) {
    let element: Element = scroller;
    for (;;) {
      const child = Array.from(element.children).find(
        (candidate) => candidate.getBoundingClientRect().bottom > edge,
      );
      if (!child) break;
      element = child;
      if (child.getBoundingClientRect().top >= edge && child.closest(MESSAGE_ROW)) break;
    }
    if (element === scroller) break;
    const rect = element.getBoundingClientRect();
    if (element.closest(MESSAGE_ROW)) found.push({ element, top: rect.top });
    edge = rect.bottom;
  }
  return found;
}

// Read during render: the DOM still shows the previous commit, so these are the positions
// before the commit that moves them. The message row stands in when the commit replaces
// every element in view.
function captureAnchor(scroller: HTMLElement | null, messages: readonly { id: string }[]) {
  if (!scroller) return null;
  const rows = Array.from(scroller.querySelectorAll<HTMLElement>(MESSAGE_ROW));
  const viewportTop = scroller.getBoundingClientRect().top;
  const id = headAnchorId(
    rows.map((row) => row.dataset.messageId ?? ''),
    messages.map((message) => message.id),
    rows.findIndex((row) => row.getBoundingClientRect().bottom > viewportTop),
  );
  const row = id === null ? null : messageRow(scroller, id);
  return {
    elements: elementsInView(scroller),
    row: id !== null && row ? { id, top: row.getBoundingClientRect().top } : null,
  };
}

// Net of the content's bottom padding, so the anchored turn top is exactly max scroll.
function reservedTurnHeight(scroller: HTMLElement, content: Element) {
  return scroller.clientHeight - parseFloat(getComputedStyle(content).paddingBottom);
}

interface UseChatScrollParams {
  chatId: string | undefined;
  // Opens with this message at the bottom of the viewport instead of the latest one.
  initialMessageId: string | undefined;
  messages: readonly { id: string }[];
  lastReplyStreams: boolean;
  pendingUserMessageId: string | null;
  latestUserMessageId: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

// Stick-to-bottom, top-pagination, and send-anchor for the message scroller.
export function useChatScroll({
  chatId,
  initialMessageId,
  messages,
  lastReplyStreams,
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
      setAtBottom(container, isAtBottomRef, atBottom);
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
      const target = initialMessageId ? messageRow(container, initialMessageId) : null;
      const top = target
        ? target.getBoundingClientRect().bottom -
          container.getBoundingClientRect().top +
          container.scrollTop -
          container.clientHeight
        : container.scrollHeight;
      writeScrollTop(container, top, lastScrollTopRef);
      hasInitializedToBottomRef.current = true;
    });
    // Cancel so a chat switch or unmount can't let the stale frame scroll the
    // old container and mark the new chat as already initialized.
    return () => cancelAnimationFrame(raf);
  }, [messages, initialMessageId]);

  const committedMessagesRef = useRef(messages);
  const committedReplyStreamsRef = useRef(lastReplyStreams);
  const headRoundingRef = useRef(0);
  // The two commits that change the height of content above a reader: the head of the list
  // changing, and a finished reply's work trace collapsing.
  const anchor =
    committedMessagesRef.current[0]?.id !== messages[0]?.id ||
    (committedReplyStreamsRef.current && !lastReplyStreams)
      ? captureAnchor(scrollerRef.current, messages)
      : null;

  // Engines without scroll anchoring leave scrollTop alone when the content above the
  // reader changes height; a pinned reader is kept at the bottom by the observer instead.
  useLayoutEffect(() => {
    committedMessagesRef.current = messages;
    committedReplyStreamsRef.current = lastReplyStreams;
    const scroller = scrollerRef.current;
    if (!anchor || !scroller || isAtBottomRef.current) return;
    const held = anchor.elements.find(({ element }) => element.isConnected);
    const row = anchor.row && messageRow(scroller, anchor.row.id);
    let moved = 0;
    if (held) {
      moved = held.element.getBoundingClientRect().top - held.top;
    } else if (anchor.row && row) {
      moved = row.getBoundingClientRect().top - anchor.row.top;
    }
    // Engines that keep scrollTop whole drop the fraction; carried so it cannot add up.
    // A larger difference is the scroll range clamping the write, which must not carry.
    const target = scroller.scrollTop + moved + headRoundingRef.current;
    if (target === scroller.scrollTop) return;
    writeScrollTop(scroller, target, lastScrollTopRef);
    const dropped = target - scroller.scrollTop;
    headRoundingRef.current = Math.abs(dropped) < 1 ? dropped : 0;
  }, [messages, lastReplyStreams, anchor]);

  useLayoutEffect(() => {
    // Send anchor, step 1 of a two-commit handshake: reserve a viewport of space under
    // the new turn (the reply streams into it instead of growing the page); the state
    // commit re-fires step 2, which scrolls once the spacer exists in the DOM.
    const scroller = scrollerRef.current;
    if (!pendingUserMessageId || !scroller?.firstElementChild) return;
    anchorTurnRef.current = pendingUserMessageId;
    // Sending takes the reader to the new turn, wherever they had scrolled to.
    setAtBottom(scroller, isAtBottomRef, true);
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
        setAtBottom(node, isAtBottomRef, isAtBottomRef.current);
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
