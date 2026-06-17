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
import { UserMessage, AssistantMessage } from '@/components/chat/message-bubble/Message';
import { QueueMessageCard } from './QueueMessageCard';
import { StreamActionsBar } from './StreamActionsBar';
import { Input } from '@/components/chat/message-input/Input';
import { ChatSkeleton } from './ChatSkeleton';
import { ScrollButton } from './ScrollButton';
import { ThinkingIndicator } from './ThinkingIndicator';
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

  if (prevChatIdForScrollRef.current !== chatId) {
    prevChatIdForScrollRef.current = chatId;
    hasInitializedToBottomRef.current = false;
    topPaginationArmedRef.current = false;
    lastScrollTopRef.current = null;
    isAtBottomRef.current = true;
    prevScrollHeightRef.current = null;
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

    const isScrollingUp = lastScrollTopRef.current !== null && scrollTop < lastScrollTopRef.current;
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

  // Follow output during streaming
  useEffect(() => {
    if (isStreaming && isAtBottomRef.current) {
      const container = scrollerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [messages, isStreaming]);

  const scrollToBottom = useCallback(() => {
    setShowScrollButton(false);
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' });
  }, []);

  const containerRefCallback = useCallback(
    (node: HTMLDivElement | null) => {
      const prev = scrollerRef.current;
      if (prev) {
        prev.removeEventListener('scroll', handleScroll);
      }
      scrollerRef.current = node;
      if (node) {
        lastScrollTopRef.current = node.scrollTop;
        node.addEventListener('scroll', handleScroll, { passive: true });
      }
    },
    [handleScroll],
  );

  const { lastBotMessage, latestUserMessageId } = useMemo(() => {
    let latestAssistantMessage: (typeof messages)[number] | undefined;
    let latestUserId: string | null = null;

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const isAssistantMessage = message.is_bot ?? message.role === 'assistant';

      if (!latestAssistantMessage && isAssistantMessage) {
        latestAssistantMessage = message;
      }

      if (latestUserId === null && !isAssistantMessage) {
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
      const isBotMessage = msg.is_bot ?? msg.role === 'assistant';
      const isLastBotMessage = isBotMessage && msg.id === lastBotMessageId;
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
        <div className="w-full lg:mx-auto lg:max-w-3xl">
          {isBotMessage ? (
            <AssistantMessage
              id={msg.id}
              contentText={msg.content_text}
              contentRender={msg.content_render}
              attachments={attachments}
              isStreaming={messageIsStreaming}
              createdAt={msg.created_at}
              modelId={msg.model_id}
              checkpointId={msg.checkpoint_id}
              isLastBotMessage={isLastBotMessage && !messageIsStreaming}
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
    [isLoading, lastBotMessageId, latestUserMessageId, pendingUserMessageId, streamingMessageIdSet],
  );

  const listHeader = useMemo(() => {
    if (!hasNextPage) {
      return null;
    }

    return (
      <div className="w-full lg:mx-auto lg:max-w-3xl">
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

  const showThinking = isLoading || (isStreaming && !lastBotHasContent);

  const listFooter = useMemo(() => {
    if (!showThinking && !showPermissionAtEnd) {
      return null;
    }

    return (
      <div className="w-full lg:mx-auto lg:max-w-3xl">
        {showThinking && <ThinkingIndicator />}
        {showPermissionAtEnd && <MessageInlinePermission />}
      </div>
    );
  }, [showPermissionAtEnd, showThinking]);

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-hidden">
        {isInitialLoading && messages.length === 0 ? (
          <ChatSkeleton messageCount={3} className="py-4" />
        ) : (
          <div
            key={chatId ?? 'chat'}
            ref={containerRefCallback}
            className="scrollbar-thin scrollbar-thumb-border-secondary dark:scrollbar-thumb-border-dark hover:scrollbar-thumb-text-quaternary dark:hover:scrollbar-thumb-border-dark-hover scrollbar-track-transparent h-full overflow-y-auto overflow-x-hidden"
          >
            {listHeader}

            {messages.map((msg) => (
              <div key={msg.id}>{renderMessage(msg)}</div>
            ))}

            {listFooter}
          </div>
        )}
      </div>
      <div className="relative">
        {showScrollButton && <ScrollButton onClick={scrollToBottom} />}

        <div className="relative bg-surface pb-safe dark:bg-surface-dark">
          <div className="relative w-full py-2 lg:mx-auto lg:max-w-3xl">
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
            {showStreamActions && chatId && (
              <div className="relative z-10">
                <StreamActionsBar chatId={chatId} />
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
