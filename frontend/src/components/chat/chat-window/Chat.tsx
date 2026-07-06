import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  memo,
  useMemo,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { isBrowserObjectUrl } from '@/utils/attachmentUrl';
import { isAssistantMessage } from '@/utils/message';
import { UserMessage, AssistantMessage } from '@/components/chat/message-bubble/Message';
import { QueueMessageCard } from './QueueMessageCard';
import { StreamActionsBar } from './StreamActionsBar';
import { Input } from '@/components/chat/message-input/Input';
import { ChatSkeleton } from './ChatSkeleton';
import { ScrollButton } from './ScrollButton';
import { MessageTrail } from './MessageTrail';
import { StatusTypewriter } from './StatusTypewriter';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { useStreamStore } from '@/store/streamStore';
import { useMessageQueueStore, EMPTY_QUEUE } from '@/store/messageQueueStore';
import { ToolPermissionInline } from '@/components/chat/tools/ToolPermissionInline';
import { useChatContext } from '@/hooks/useChatContext';
import {
  useChatSessionContext,
  useChatSessionState,
  useChatSessionActions,
} from '@/hooks/useChatSessionContext';
import { useChatInputMessageContext } from '@/hooks/useChatInputMessageContext';
import { useUIStore } from '@/store/uiStore';
import { queryKeys } from '@/hooks/queries/queryKeys';

const AT_BOTTOM_THRESHOLD_PX = 200;
const TOP_PAGINATION_TRIGGER_PX = 50;
const TOP_PAGINATION_ARM_VIEWPORT_MULTIPLIER = 1.5;

const MessageInlinePermission = memo(function MessageInlinePermission() {
  const state = useChatSessionState();
  const actions = useChatSessionActions();

  if (
    !state.pendingPermissionRequest ||
    state.pendingPermissionRequest.tool_name === 'ExitPlanMode'
  ) {
    return null;
  }

  return (
    <div className="mb-3 mt-1 px-4 sm:px-6">
      <ToolPermissionInline
        request={state.pendingPermissionRequest}
        onApprove={actions.onPermissionApprove}
        onReject={actions.onPermissionReject}
        isLoading={state.isPermissionLoading}
        error={state.permissionError}
      />
    </div>
  );
});

export const Chat = memo(function Chat() {
  const { chatId } = useChatContext();
  const { state, actions } = useChatSessionContext();
  const queryClient = useQueryClient();

  const {
    messages,
    pendingUserMessageId,
    isLoading,
    isStreaming,
    isInitialLoading,
    attachedFiles,
    selectedModelId,
    contextUsage,
    hasNextPage,
    isFetchingNextPage,
    pendingPermissionRequest,
  } = state;

  const { onSubmit, onStopStream, onAttach, onModelChange, fetchNextPage } = actions;

  const { inputMessage, setInputMessage } = useChatInputMessageContext();

  useEffect(() => {
    return useUIStore.subscribe((state, prev) => {
      if (
        state.pendingChatMessage &&
        state.pendingChatMessage !== prev.pendingChatMessage &&
        state.pendingChatMessage.chatId === chatId
      ) {
        setInputMessage(state.pendingChatMessage.message);
        useUIStore.getState().setPendingChatMessage(null);
      }
    });
  }, [chatId, setInputMessage]);

  const { activeStreams, streamIdByChatMessage } = useStreamStore(
    useShallow((s) => ({
      activeStreams: s.activeStreams,
      streamIdByChatMessage: s.streamIdByChatMessage,
    })),
  );
  const streamingMessageIdSet = useMemo(() => {
    const ids = new Set<string>();
    if (!chatId) return ids;

    for (const streamId of streamIdByChatMessage.values()) {
      const stream = activeStreams.get(streamId);
      if (stream?.chatId === chatId && stream.isActive) {
        ids.add(stream.messageId);
      }
    }

    return ids;
  }, [activeStreams, chatId, streamIdByChatMessage]);

  // Real start time of the active stream for this chat, so the thinking timer
  // doesn't reset when switching chats and the indicator remounts.
  const streamStartTime = useStreamStore((s) =>
    chatId ? s.activeStreamMetadata.find((m) => m.chatId === chatId)?.startTime : undefined,
  );

  const pendingMessages = useMessageQueueStore((storeState) =>
    chatId ? (storeState.queues.get(chatId) ?? EMPTY_QUEUE) : EMPTY_QUEUE,
  );

  useEffect(() => {
    if (chatId) {
      void useMessageQueueStore.getState().fetchQueue(chatId);
    }
  }, [chatId]);

  const handleCancelMessage = useCallback(
    (messageId: string) => {
      if (chatId) {
        void useMessageQueueStore.getState().removeMessage(chatId, messageId);
      }
    },
    [chatId],
  );

  const handleEditMessage = useCallback(
    (messageId: string, newContent: string) => {
      if (chatId) {
        void useMessageQueueStore.getState().updateQueuedMessage(chatId, messageId, newContent);
      }
    },
    [chatId],
  );

  const handleSendNow = useCallback(
    async (messageId: string) => {
      if (!chatId) return;
      const success = await useMessageQueueStore.getState().sendNow(chatId, messageId);
      if (success && !isStreaming) {
        useMessageQueueStore.getState().removeLocalOnly(chatId, messageId);
        await queryClient.invalidateQueries({ queryKey: queryKeys.messages(chatId) });
      }
    },
    [chatId, isStreaming, queryClient],
  );

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

  const { lastBotMessage, latestUserMessageId } = useMemo(() => {
    let latestAssistantMessage: (typeof messages)[number] | undefined;
    let latestUserId: string | null = null;

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const isAssistant = isAssistantMessage(message);

      if (!latestAssistantMessage && isAssistant) {
        latestAssistantMessage = message;
      }

      if (latestUserId === null && !isAssistant) {
        latestUserId = message.id;
      }

      if (latestAssistantMessage && latestUserId !== null) {
        break;
      }
    }

    return {
      lastBotMessage: latestAssistantMessage,
      latestUserMessageId: latestUserId,
    };
  }, [messages]);

  const lastBotMessageId = lastBotMessage?.id ?? null;

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

  const turns = useMemo(() => {
    // Group each user message with the assistant output that follows so the last
    // turn can carry the send-anchor min-height without reparenting rows mid-stream.
    const groups: (typeof messages)[] = [];
    for (const msg of messages) {
      if (isAssistantMessage(msg) && groups.length > 0) {
        groups[groups.length - 1].push(msg);
      } else {
        groups.push([msg]);
      }
    }
    return groups;
  }, [messages]);

  const canShowPermissionInline =
    pendingPermissionRequest && pendingPermissionRequest.tool_name !== 'ExitPlanMode';
  const lastBotIsStreaming = !!lastBotMessageId && streamingMessageIdSet.has(lastBotMessageId);
  const lastBotHasContent =
    !!lastBotMessage &&
    ((lastBotMessage.content_render?.events?.length ?? 0) > 0 || !!lastBotMessage.content_text);
  const showPermissionAtEnd = canShowPermissionInline && (!lastBotMessageId || lastBotIsStreaming);
  // Only offer actions against a cleanly completed turn — skips failed/interrupted
  // output and the reconnect window where an in-progress message isn't yet in the stream set.
  const showStreamActions =
    lastBotMessage?.stream_status === 'completed' &&
    !lastBotIsStreaming &&
    !isStreaming &&
    !isLoading;

  const renderMessage = useCallback(
    (msg: (typeof messages)[number]) => {
      const messageIsStreaming = streamingMessageIdSet.has(msg.id);
      const isBotMessage = isAssistantMessage(msg);
      const isLastBotMessage = isBotMessage && msg.id === lastBotMessageId;
      // A not-yet-populated bot row renders only its padding, pushing the thinking
      // indicator below it down a few pixels — hide it until content lands. Gate on the
      // turn being active, not streamingMessageIdSet: the row can land in the message
      // list before the stream store registers its message id.
      if (isLastBotMessage && !lastBotHasContent && (isLoading || isStreaming)) {
        return null;
      }
      const attachments = msg.attachments ?? [];
      const localAttachmentIds = attachments.reduce<string[]>((acc, attachment) => {
        if (isBrowserObjectUrl(attachment.file_url)) acc.push(attachment.id);
        return acc;
      }, []);
      const isLatestUserMessage = !isBotMessage && msg.id === latestUserMessageId;
      const shouldShowUploadingOverlay =
        localAttachmentIds.length > 0 &&
        (pendingUserMessageId === msg.id ||
          (isLatestUserMessage && (pendingUserMessageId !== null || isLoading)));
      const uploadingAttachmentIds = shouldShowUploadingOverlay ? localAttachmentIds : undefined;

      return (
        <div className="w-full lg:mx-auto lg:max-w-4xl">
          {isBotMessage ? (
            <AssistantMessage
              id={msg.id}
              contentText={msg.content_text}
              contentRender={msg.content_render}
              attachments={attachments}
              isStreaming={messageIsStreaming}
              createdAt={msg.created_at}
              modelId={msg.model_id}
              durationMs={msg.duration_ms}
              checkpointId={msg.checkpoint_id}
              // Idle-gated so prompt suggestions unmount in the send commit itself —
              // unmounting when the placeholder lands shifts the anchored turn late.
              isLastBotMessage={
                isLastBotMessage && !messageIsStreaming && !isLoading && !isStreaming
              }
            />
          ) : (
            <UserMessage
              id={msg.id}
              contentText={msg.content_text}
              contentRender={msg.content_render}
              attachments={attachments}
              uploadingAttachmentIds={uploadingAttachmentIds}
              isStreaming={messageIsStreaming}
            />
          )}
          {isLastBotMessage && !messageIsStreaming && <MessageInlinePermission />}
        </div>
      );
    },
    [
      isLoading,
      isStreaming,
      lastBotHasContent,
      lastBotMessageId,
      latestUserMessageId,
      pendingUserMessageId,
      streamingMessageIdSet,
    ],
  );

  const listHeader = useMemo(() => {
    if (!hasNextPage) {
      return null;
    }

    return (
      <div className="w-full lg:mx-auto lg:max-w-4xl">
        <div className="flex h-4 items-center justify-center p-4">
          {isFetchingNextPage && (
            <div className="flex items-center gap-2 text-sm text-text-secondary dark:text-text-dark-secondary">
              <Spinner size="xs" />
              Loading older messages...
            </div>
          )}
        </div>
      </div>
    );
  }, [hasNextPage, isFetchingNextPage]);

  // !lastBotIsStreaming covers the follow-up-turn handoff: the previous turn's
  // message (with content) is still the last bot row until the new stream's message
  // lands in the list — without it the indicator unmounts/remounts, restarting the
  // typewriter at "Pondering".
  const showThinking = isLoading || (isStreaming && (!lastBotIsStreaming || !lastBotHasContent));

  const listFooter = useMemo(() => {
    if (!showThinking && !showPermissionAtEnd && !(showStreamActions && chatId)) {
      return null;
    }

    return (
      <div className="w-full lg:mx-auto lg:max-w-4xl">
        {showThinking && <StatusTypewriter streamStartTime={streamStartTime} />}
        {showPermissionAtEnd && <MessageInlinePermission />}
        {showStreamActions && chatId && <StreamActionsBar chatId={chatId} />}
      </div>
    );
  }, [chatId, showPermissionAtEnd, showStreamActions, showThinking, streamStartTime]);

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <div className="relative flex-1 overflow-hidden">
        {isInitialLoading && messages.length === 0 ? (
          <ChatSkeleton messageCount={3} className="py-4" />
        ) : (
          <>
            <div
              key={chatId ?? 'chat'}
              ref={containerRefCallback}
              className="scrollbar-thin scrollbar-thumb-border-secondary dark:scrollbar-thumb-border-dark hover:scrollbar-thumb-text-quaternary dark:hover:scrollbar-thumb-border-dark-hover scrollbar-track-transparent h-full overflow-y-auto overflow-x-hidden"
            >
              {/* Single wrapper so the stick-to-bottom ResizeObserver tracks all content */}
              <div>
                {listHeader}

                {turns.map((turn, turnIndex) => {
                  const isLastTurn = turnIndex === turns.length - 1;
                  return (
                    <div
                      key={turn[0].id}
                      ref={isLastTurn ? turnRef : undefined}
                      style={
                        isLastTurn && turnMinHeight > 0 ? { minHeight: turnMinHeight } : undefined
                      }
                    >
                      {turn.map((msg) => (
                        <div key={msg.id} data-message-id={msg.id}>
                          {renderMessage(msg)}
                        </div>
                      ))}
                      {isLastTurn && listFooter}
                    </div>
                  );
                })}

                {turns.length === 0 && listFooter}
              </div>
            </div>
            <MessageTrail messages={messages} scrollerRef={scrollerRef} />
          </>
        )}
      </div>
      <div className="relative">
        {showScrollButton && <ScrollButton onClick={scrollToBottom} />}

        <div className="relative bg-surface pb-safe dark:bg-surface-dark">
          <div className="relative w-full py-2 lg:mx-auto lg:max-w-4xl">
            {pendingMessages.length > 0 && (
              <div className="relative z-0 -mb-4 px-10 sm:px-14">
                <div className="flex flex-col overflow-hidden rounded-t-2xl border border-b-0 border-border/50 bg-surface-secondary pb-4 dark:border-border-dark/50 dark:bg-surface-dark-secondary">
                  {pendingMessages.map((pending) => (
                    <QueueMessageCard
                      key={pending.id}
                      message={pending}
                      onCancel={handleCancelMessage}
                      onEdit={handleEditMessage}
                      onSendNow={handleSendNow}
                    />
                  ))}
                </div>
              </div>
            )}
            <div className="relative z-10">
              <Input
                message={inputMessage}
                setMessage={setInputMessage}
                onSubmit={onSubmit}
                onAttach={onAttach}
                attachedFiles={attachedFiles}
                isLoading={isLoading}
                isStreaming={isStreaming}
                onStopStream={onStopStream}
                selectedModelId={selectedModelId}
                onModelChange={onModelChange}
                dropdownPosition="top"
                showAttachedFilesPreview={true}
                contextUsage={contextUsage}
                showTip={false}
                chatId={chatId}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
