import { useCallback, useEffect, memo, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useChatMachineId } from '@/store/machineOrigin';
import { useMachineName, useMachineStatus } from '@/store/machineStore';
import { useShallow } from 'zustand/react/shallow';
import { isBrowserObjectUrl } from '@/utils/attachmentUrl';
import { isAssistantMessage } from '@/utils/message';
import { UserMessage, AssistantMessage } from '@/components/chat/message-bubble/Message';
import { ChatQueueBanner } from './ChatQueueBanner';
import { ChatInlinePermission } from './ChatInlinePermission';
import { ChatInlineElicitation } from './ChatInlineElicitation';
import { StreamActionsBar } from './StreamActionsBar';
import { Input } from '@/components/chat/message-input/Input';
import { ChatSkeleton } from './ChatSkeleton';
import {
  ConversationColumn,
  ConversationLayout,
  ConversationOlderPages,
  ConversationScroller,
} from './ConversationLayout';
import { MessageTrail } from './MessageTrail';
import { FindInChat } from './FindInChat';
import { ForkOriginBadge } from './ForkOriginBadge';
import { ChatSelectionActions } from './ChatSelectionActions';
import { StatusTypewriter } from './StatusTypewriter';
import { useChatScroll } from './useChatScroll';
import { TextRevealContext, type TextReveal } from './TextRevealContext';
import { useStreamStore } from '@/store/streamStore';
import { useMessageQueueStore, EMPTY_QUEUE, sendQueuedMessageNow } from '@/store/messageQueueStore';
import { useChatContext } from '@/hooks/useChatContext';
import { useChatQuery } from '@/hooks/queries/useChatQueries';
import { useChatSessionContext } from '@/hooks/useChatSessionContext';
import { useChatInputMessageContext } from '@/hooks/useChatInputMessageContext';
import { useUIStore } from '@/store/uiStore';

export const Chat = memo(function Chat() {
  const { chatId } = useChatContext();
  const machineId = useChatMachineId(chatId);
  const machineOnline = useMachineStatus(machineId) === 'online';
  const machineLabel = useMachineName(machineId);
  const { state, actions } = useChatSessionContext();
  const { data: chat } = useChatQuery(chatId);
  const initialMessageId = (useLocation().state as { messageId?: string } | null)?.messageId;
  const forkOrigin = chat?.forked_from_chat_id
    ? {
        sourceChatId: chat.forked_from_chat_id,
        sourceMessageId: chat.forked_from_message_id ?? null,
        sourceTitle: chat.forked_from_title ?? '',
      }
    : null;

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
    pendingElicitationRequest,
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
      if (chatId) await sendQueuedMessageNow(chatId, messageId);
    },
    [chatId],
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

  // A reply whose stream has ended keeps its streaming presentation until the turn is
  // idle and its text has finished revealing, so the action row, the suggestions and the
  // collapsed trace land in one commit instead of one per state source.
  const [settlingMessageId, setSettlingMessageId] = useState<string | null>(null);
  const [revealingTextCount, setRevealingTextCount] = useState(0);
  // Trailer slots the ended reply did not fill stay reserved until the next send.
  const [endedMessageId, setEndedMessageId] = useState<string | null>(null);
  const [prevStreamingIds, setPrevStreamingIds] = useState(streamingMessageIdSet);
  if (prevStreamingIds !== streamingMessageIdSet) {
    setPrevStreamingIds(streamingMessageIdSet);
    if (
      lastBotMessageId &&
      prevStreamingIds.has(lastBotMessageId) &&
      !streamingMessageIdSet.has(lastBotMessageId)
    ) {
      setSettlingMessageId(lastBotMessageId);
      setEndedMessageId(lastBotMessageId);
    }
  }
  const lastBotStreams = !!lastBotMessageId && streamingMessageIdSet.has(lastBotMessageId);
  // A new send lands the rest at once, in the commit the send anchor measures.
  const lastBotSettling =
    !lastBotStreams &&
    lastBotMessageId !== null &&
    settlingMessageId === lastBotMessageId &&
    !pendingUserMessageId &&
    (isStreaming || revealingTextCount > 0);
  if (settlingMessageId !== null && !lastBotSettling) {
    setSettlingMessageId(null);
  }
  const lastBotIsStreaming = lastBotStreams || lastBotSettling;
  const lastBotHoldsTrailer =
    endedMessageId === lastBotMessageId && !lastBotIsStreaming && !isStreaming && !isLoading;
  const beginTextReveal = useCallback(() => setRevealingTextCount((count) => count + 1), []);
  // A frame later, so the last words paint before the reply settles instead of with it.
  const endTextReveal = useCallback(() => {
    requestAnimationFrame(() => setRevealingTextCount((count) => count - 1));
  }, []);
  const textReveal = useMemo<TextReveal>(
    () => ({ streamEnded: lastBotSettling, begin: beginTextReveal, end: endTextReveal }),
    [lastBotSettling, beginTextReveal, endTextReveal],
  );

  const {
    scrollerRef,
    turnRef,
    turnMinHeight,
    showScrollButton,
    containerRefCallback,
    scrollToBottom,
  } = useChatScroll({
    chatId,
    initialMessageId,
    messages,
    lastReplyStreams: lastBotIsStreaming,
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
  const lastBotHasContent =
    !!lastBotMessage &&
    ((lastBotMessage.content_render?.events?.length ?? 0) > 0 || !!lastBotMessage.content_text);
  // A not-yet-populated bot row renders only its padding, pushing the thinking
  // indicator below it down a few pixels — hide it until content lands. Gate on the
  // turn being active, not streamingMessageIdSet: the row can land in the message
  // list before the stream store registers its message id.
  const lastBotRowHidden = !lastBotHasContent && (isLoading || isStreaming);
  // The latest row that actually renders keeps its actions visible.
  const lastMessage = messages[messages.length - 1];
  const latestMessageId = (
    lastBotRowHidden && lastMessage?.id === lastBotMessageId
      ? messages[messages.length - 2]
      : lastMessage
  )?.id;
  const showPermissionAtEnd = canShowPermissionInline && (!lastBotMessageId || lastBotIsStreaming);
  // Permission and elicitation share the slot; a pending permission wins.
  const canShowElicitationInline = !!pendingElicitationRequest && !pendingPermissionRequest;
  const showElicitationAtEnd =
    canShowElicitationInline && (!lastBotMessageId || lastBotIsStreaming);
  // Only offer actions against a cleanly completed turn — skips failed/interrupted
  // output and the reconnect window where an in-progress message isn't yet in the stream set.
  const showStreamActions =
    lastBotMessage?.stream_status === 'completed' &&
    !lastBotIsStreaming &&
    !isStreaming &&
    !isLoading;
  const showStreamActionsSlot =
    showStreamActions || ((lastBotIsStreaming || lastBotHoldsTrailer) && lastBotHasContent);

  const renderMessage = useCallback(
    (msg: (typeof messages)[number], hasReply: boolean) => {
      const isBotMessage = isAssistantMessage(msg);
      const isLastBotMessage = isBotMessage && msg.id === lastBotMessageId;
      const messageIsStreaming = isLastBotMessage
        ? lastBotIsStreaming
        : streamingMessageIdSet.has(msg.id);
      if (isLastBotMessage && lastBotRowHidden) {
        return null;
      }
      const attachments = msg.attachments ?? [];
      const localAttachmentIds = attachments.reduce<string[]>((acc, attachment) => {
        if (attachment.file_url instanceof File || isBrowserObjectUrl(attachment.file_url)) {
          acc.push(attachment.id);
        }
        return acc;
      }, []);
      const isLatestUserMessage = !isBotMessage && msg.id === latestUserMessageId;
      const shouldShowUploadingOverlay =
        localAttachmentIds.length > 0 &&
        (pendingUserMessageId === msg.id ||
          (isLatestUserMessage && (pendingUserMessageId !== null || isLoading)));
      const uploadingAttachmentIds = shouldShowUploadingOverlay ? localAttachmentIds : undefined;

      return (
        <ConversationColumn>
          {isBotMessage ? (
            <TextRevealContext value={isLastBotMessage && lastBotIsStreaming ? textReveal : null}>
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
                toolResultsOmitted={msg.tool_results_omitted}
                isCompleted={msg.stream_status === 'completed'}
                // Idle-gated so prompt suggestions unmount in the send commit itself —
                // unmounting when the placeholder lands shifts the anchored turn late.
                isLastBotMessage={
                  isLastBotMessage && !messageIsStreaming && !isLoading && !isStreaming
                }
                isLatest={msg.id === latestMessageId}
                // An inline prompt sits right under the reply, with no gap for the trailer
                reserveTrailer={messageIsStreaming && !showPermissionAtEnd && !showElicitationAtEnd}
                holdTrailer={isLastBotMessage && lastBotHoldsTrailer}
              />
            </TextRevealContext>
          ) : (
            <UserMessage
              id={msg.id}
              contentText={msg.content_text}
              contentRender={msg.content_render}
              attachments={attachments}
              uploadingAttachmentIds={uploadingAttachmentIds}
              isStreaming={messageIsStreaming}
              isLatest={msg.id === latestMessageId}
              hasReply={hasReply}
            />
          )}
          {isLastBotMessage && !messageIsStreaming && (
            <>
              <ChatInlinePermission />
              <ChatInlineElicitation />
            </>
          )}
        </ConversationColumn>
      );
    },
    [
      isLoading,
      isStreaming,
      lastBotRowHidden,
      lastBotHoldsTrailer,
      lastBotIsStreaming,
      lastBotMessageId,
      latestMessageId,
      latestUserMessageId,
      pendingUserMessageId,
      showElicitationAtEnd,
      showPermissionAtEnd,
      streamingMessageIdSet,
      textReveal,
    ],
  );

  // !lastBotIsStreaming covers the follow-up-turn handoff: the previous turn's
  // message (with content) is still the last bot row until the new stream's message
  // lands in the list — without it the indicator unmounts/remounts, restarting the
  // typewriter at "Pondering".
  const showThinking = isLoading || (isStreaming && (!lastBotIsStreaming || !lastBotHasContent));

  const listFooter = useMemo(() => {
    if (
      !showThinking &&
      !showPermissionAtEnd &&
      !showElicitationAtEnd &&
      !(showStreamActionsSlot && chatId)
    ) {
      return null;
    }

    return (
      <ConversationColumn>
        {showThinking && <StatusTypewriter streamStartTime={streamStartTime} />}
        {showPermissionAtEnd && <ChatInlinePermission />}
        {showElicitationAtEnd && <ChatInlineElicitation />}
        {showStreamActionsSlot && chatId && (
          <StreamActionsBar chatId={chatId} pending={!showStreamActions} />
        )}
      </ConversationColumn>
    );
  }, [
    chatId,
    showElicitationAtEnd,
    showPermissionAtEnd,
    showStreamActions,
    showStreamActionsSlot,
    showThinking,
    streamStartTime,
  ]);

  return (
    <ConversationLayout
      showScrollButton={showScrollButton}
      onScrollToBottom={scrollToBottom}
      composerBanner={
        <>
          {forkOrigin && messages.length === 0 && !isInitialLoading && (
            <ForkOriginBadge {...forkOrigin} aboveComposer />
          )}
          <ChatQueueBanner
            messages={pendingMessages}
            onCancel={handleCancelMessage}
            onEdit={handleEditMessage}
            onSendNow={handleSendNow}
          />
        </>
      }
      composer={
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
          chatId={chatId}
          disabled={!machineOnline}
          placeholder={machineOnline ? undefined : `${machineLabel} is offline — read-only`}
        />
      }
    >
      {isInitialLoading && messages.length === 0 ? (
        <ChatSkeleton messageCount={3} />
      ) : (
        <>
          {/* Single wrapper so the stick-to-bottom ResizeObserver tracks all content */}
          <ConversationScroller key={chatId ?? 'chat'} ref={containerRefCallback}>
            <ConversationOlderPages
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
            />

            {turns.map((turn, turnIndex) => {
              const isLastTurn = turnIndex === turns.length - 1;
              return (
                <div
                  key={turn[0].id}
                  ref={isLastTurn ? turnRef : undefined}
                  style={isLastTurn && turnMinHeight > 0 ? { minHeight: turnMinHeight } : undefined}
                >
                  {/* Inside the turn so the send anchor keeps it in view with the message. */}
                  {forkOrigin && turnIndex === 0 && !hasNextPage && (
                    <ConversationColumn>
                      <ForkOriginBadge {...forkOrigin} />
                    </ConversationColumn>
                  )}
                  {turn.map((msg, index) => (
                    <div key={msg.id} data-message-id={msg.id}>
                      {renderMessage(msg, index === 0 && turn.length > 1)}
                    </div>
                  ))}
                  {isLastTurn && listFooter}
                </div>
              );
            })}

            {turns.length === 0 && listFooter}

            {/* Inside the content wrapper so the selection toolbar / ask
                panel anchor in content coordinates and scroll with it */}
            <ChatSelectionActions
              chatId={chatId}
              defaultModelId={selectedModelId}
              scrollerRef={scrollerRef}
            />
          </ConversationScroller>
          <MessageTrail messages={messages} scrollerRef={scrollerRef} />
          {/* Keyed by chat so query/match state resets on chat switch */}
          <FindInChat key={`find-${chatId ?? 'chat'}`} scrollerRef={scrollerRef} />
        </>
      )}
    </ConversationLayout>
  );
});
