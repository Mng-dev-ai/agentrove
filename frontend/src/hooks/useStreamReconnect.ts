import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { logger } from '@/utils/logger';
import { chatService } from '@/services/chatService';
import { chatStorage } from '@/utils/storage';
import { useStreamStore } from '@/store/streamStore';
import type { Message } from '@/types/chat.types';
import type { StreamState } from '@/types/stream.types';

interface UseStreamReconnectParams {
  chatId: string | undefined;
  fetchedMessages: Message[];
  hasFetchedMessages: boolean;
  isInitialLoading: boolean;
  streamState: StreamState;
  currentMessageId: string | null;
  wasAborted: boolean;
  selectedModelId: string | null | undefined;
  setStreamState: Dispatch<SetStateAction<StreamState>>;
  setCurrentMessageId: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  addMessageToCache: (message: Message) => void;
  updateMessageInCache: (messageId: string, updater: (msg: Message) => Message) => void;
  replayStream: (messageId: string, afterSeq?: number) => Promise<string>;
}

// On chat entry (navigation, page refresh), polls the server for an active task,
// resolves the replay cursor from the highest of (server last_seq, local chatStorage
// seq, message last_seq), then replays the SSE stream from that point so the UI
// catches up without re-fetching the full history.
export function useStreamReconnect({
  chatId,
  fetchedMessages,
  hasFetchedMessages,
  isInitialLoading,
  streamState,
  currentMessageId,
  wasAborted,
  selectedModelId,
  setStreamState,
  setCurrentMessageId,
  setMessages,
  addMessageToCache,
  updateMessageInCache,
  replayStream,
}: UseStreamReconnectParams): void {
  const fetchedMessagesRef = useRef(fetchedMessages);
  fetchedMessagesRef.current = fetchedMessages;
  const selectedModelIdRef = useRef(selectedModelId);
  selectedModelIdRef.current = selectedModelId;

  useEffect(() => {
    if (!chatId || isInitialLoading || !hasFetchedMessages) return;
    if (streamState !== 'idle' || currentMessageId || wasAborted) return;

    let cancelled = false;

    const reconnectToActiveStream = async () => {
      try {
        if (useStreamStore.getState().getStreamByChat(chatId)) return;

        const status = await chatService.checkChatStatus(chatId);
        if (cancelled) return;
        if (!status?.has_active_task) return;

        let targetMessageId = status.message_id;

        if (!targetMessageId) {
          const msgs = fetchedMessagesRef.current;
          let lastAssistantMessage: Message | undefined;
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant') {
              lastAssistantMessage = msgs[i];
              break;
            }
          }
          targetMessageId = lastAssistantMessage?.id;
        }

        if (!targetMessageId) return;

        setStreamState('streaming');
        setCurrentMessageId(targetMessageId);

        const messages = fetchedMessagesRef.current;
        const existingMessage = messages.find((msg) => msg.id === targetMessageId);
        const messageExists = existingMessage != null;
        // Snapshot the message's current content before replay so we can
        // restore it if the replay connection fails partway through.
        const previousSnapshot = existingMessage
          ? {
              content_text: existingMessage.content_text,
              content_render: existingMessage.content_render,
              last_seq: existingMessage.last_seq,
              active_stream_id: existingMessage.active_stream_id ?? null,
            }
          : null;

        // Pick the highest known seq across three sources: server status, local
        // storage (persisted across page refreshes), and the message's own cursor.
        // Whichever is highest is the safest point to resume from without duplicates.
        const reconnectSeq = status.last_seq ?? existingMessage?.last_seq ?? 0;
        const storedSeqRaw = chatStorage.getEventId(chatId);
        const storedSeq = storedSeqRaw ? Number(storedSeqRaw) : Number.NaN;
        const normalizedStoredSeq = Number.isFinite(storedSeq) && storedSeq > 0 ? storedSeq : 0;
        const normalizedReconnectSeq = reconnectSeq > 0 ? reconnectSeq : 0;
        // If the active assistant message is absent locally, start replay from 0 so
        // we rebuild the full message instead of resuming from a truncated cursor.
        const replayAfterSeq = messageExists
          ? Math.max(normalizedStoredSeq, normalizedReconnectSeq)
          : 0;
        if (replayAfterSeq > 0) {
          chatStorage.setEventId(chatId, String(replayAfterSeq));
        } else {
          chatStorage.removeEventId(chatId);
        }

        // If the message isn't in the local cache yet (e.g., it was created while
        // the user was on a different chat), inject a placeholder so the replay
        // pipeline has a target message to write content into.
        if (!messageExists) {
          const placeholderMessage: Message = {
            id: targetMessageId,
            chat_id: chatId,
            role: 'assistant',
            content_text: '',
            content_render: { events: [] },
            last_seq: status.last_seq ?? 0,
            active_stream_id: status.stream_id ?? null,
            stream_status: 'in_progress',
            created_at: new Date().toISOString(),
            model_id: selectedModelIdRef.current || '',
            is_bot: true,
            duration_ms: null,
            checkpoint_id: null,
          };
          addMessageToCache(placeholderMessage);
          setMessages((prev) => [...prev, placeholderMessage]);
        }

        try {
          await replayStream(targetMessageId, replayAfterSeq);
        } catch (replayError) {
          logger.error('Stream reconnect failed', 'useStreamReconnect', replayError);
          if (previousSnapshot) {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === targetMessageId ? { ...msg, ...previousSnapshot } : msg,
              ),
            );
            updateMessageInCache(targetMessageId, (msg) => ({
              ...msg,
              ...previousSnapshot,
            }));
          } else {
            const markFailed = (msg: Message): Message => ({
              ...msg,
              active_stream_id: null,
              stream_status: 'failed',
            });
            setMessages((prev) =>
              prev.map((msg) => (msg.id === targetMessageId ? markFailed(msg) : msg)),
            );
            updateMessageInCache(targetMessageId, markFailed);
          }
          setStreamState('idle');
          setCurrentMessageId(null);
        }
      } catch (checkError) {
        logger.error('Active task check failed', 'useStreamReconnect', checkError);
      }
    };

    const timeoutId = setTimeout(reconnectToActiveStream, 100);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [
    chatId,
    currentMessageId,
    hasFetchedMessages,
    isInitialLoading,
    replayStream,
    streamState,
    updateMessageInCache,
    wasAborted,
    addMessageToCache,
    setStreamState,
    setCurrentMessageId,
    setMessages,
  ]);
}
