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
  replayStream: (messageId: string, afterSeq?: number) => Promise<string>;
}

// On chat entry: poll active task, resume SSE from max(server/local/message seq).
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

        // Resume from max(server, local storage, message cursor) to avoid duplicates.
        const reconnectSeq = status.last_seq ?? existingMessage?.last_seq ?? 0;
        const storedSeqRaw = chatStorage.getEventId(chatId);
        const storedSeq = storedSeqRaw ? Number(storedSeqRaw) : Number.NaN;
        const normalizedStoredSeq = Number.isFinite(storedSeq) && storedSeq > 0 ? storedSeq : 0;
        const normalizedReconnectSeq = reconnectSeq > 0 ? reconnectSeq : 0;
        // Missing local message → replay from 0 (truncated cursor would drop content).
        const replayAfterSeq = messageExists
          ? Math.max(normalizedStoredSeq, normalizedReconnectSeq)
          : 0;
        if (replayAfterSeq > 0) {
          chatStorage.setEventId(chatId, String(replayAfterSeq));
        } else {
          chatStorage.removeEventId(chatId);
        }

        // Placeholder so replay has a target when the message was created off-screen.
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
            attachments: [],
            checkpoint_id: null,
          };
          addMessageToCache(placeholderMessage);
          setMessages((prev) => [...prev, placeholderMessage]);
        }

        // Failures surface via onError (no sync throw from shared connection register).
        await replayStream(targetMessageId, replayAfterSeq);
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
    wasAborted,
    addMessageToCache,
    setStreamState,
    setCurrentMessageId,
    setMessages,
  ]);
}
