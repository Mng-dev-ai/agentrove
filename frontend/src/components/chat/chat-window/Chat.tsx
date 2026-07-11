import { useCallback, useEffect, memo, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { isBrowserObjectUrl } from '@/utils/attachmentUrl';
import { isAssistantMessage } from '@/utils/message';
import { UserMessage, AssistantMessage } from '@/components/chat/message-bubble/Message';
import { ChatQueueBanner } from './ChatQueueBanner';
import { ChatInlinePermission } from './ChatInlinePermission';
import { StreamActionsBar } from './StreamActionsBar';
import { Input } from '@/components/chat/message-input/Input';
import { ChatSkeleton } from './ChatSkeleton';
import { ScrollButton } from './ScrollButton';
import { MessageTrail } from './MessageTrail';
import { FindInChat } from './FindInChat';
import { ChatSelectionActions } from './ChatSelectionActions';
import { StatusTypewriter } from './StatusTypewriter';
import { useChatScroll } from './useChatScroll';
import { Spinner } from '@/components/ui/primitives/Spinner/Spinner';
import { useStreamStore } from '@/store/streamStore';
import { useMessageQueueStore, EMPTY_QUEUE } from '@/store/messageQueueStore';
import { useChatContext } from '@/hooks/useChatContext';
import { useChatSessionContext } from '@/hooks/useChatSessionContext';
import { useChatInputMessageContext } from '@/hooks/useChatInputMessageContext';
import { useUIStore } from '@/store/uiStore';
import { queryKeys } from '@/hooks/queries/queryKeys';
import styles from './Chat.module.scss';

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

  const {
    scrollerRef,
    turnRef,
    turnMinHeight,
    showScrollButton,
    containerRefCallback,
    scrollToBottom,
  } = useChatScroll({
    chatId,
    messages,
    pendingUserMessageId,
    latestUserMessageId,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  });

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
        <div className={styles.column}>
          {isBotMessage ? (
            <AssistantMessage
              id={msg.id}
              contentText={msg.content_text}
              contentRender={msg.content_render}
              attachments={attachments}
              isStreaming={messageIsStreaming}
              createdAt={msg.created_at}
              modelId={msg.model_id ?? undefined}
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
          {isLastBotMessage && !messageIsStreaming && <ChatInlinePermission />}
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
      <div className={styles.column}>
        <div className={styles['list-header-row']}>
          {isFetchingNextPage && (
            <div className={styles['loading-more']}>
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
      <div className={styles.column}>
        {showThinking && <StatusTypewriter streamStartTime={streamStartTime} />}
        {showPermissionAtEnd && <ChatInlinePermission />}
        {showStreamActions && chatId && <StreamActionsBar chatId={chatId} />}
      </div>
    );
  }, [chatId, showPermissionAtEnd, showStreamActions, showThinking, streamStartTime]);

  return (
    <div className={styles.chat}>
      <div className={styles.viewport}>
        {isInitialLoading && messages.length === 0 ? (
          <ChatSkeleton messageCount={3} className={styles['skeleton-pad']} />
        ) : (
          <>
            <div key={chatId ?? 'chat'} ref={containerRefCallback} className={styles.scroller}>
              {/* Single wrapper so the stick-to-bottom ResizeObserver tracks all content */}
              <div className={styles.content}>
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

                {/* Inside the content wrapper so the selection toolbar / ask
                    panel anchor in content coordinates and scroll with it */}
                <ChatSelectionActions chatId={chatId} scrollerRef={scrollerRef} />
              </div>
            </div>
            <MessageTrail messages={messages} scrollerRef={scrollerRef} />
            {/* Keyed by chat so query/match state resets on chat switch */}
            <FindInChat key={chatId ?? 'chat'} messages={messages} scrollerRef={scrollerRef} />
          </>
        )}
      </div>
      <div className={styles.composer}>
        {showScrollButton && <ScrollButton onClick={scrollToBottom} />}

        <div className={styles['composer-surface']}>
          <div className={styles['composer-inner']}>
            <ChatQueueBanner
              messages={pendingMessages}
              onCancel={handleCancelMessage}
              onEdit={handleEditMessage}
              onSendNow={handleSendNow}
            />
            <div className={styles['input-slot']}>
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
