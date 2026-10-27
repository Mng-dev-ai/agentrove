import { useEffect, useRef } from 'react';
import { detectFileType } from '@/utils/fileTypes';
import { createInitialMessage } from '@/utils/message';
import { chatStorage } from '@/utils/storage';
import { insertMessagesById } from '@/hooks/stream/messageUpdates';
import type { Message } from '@/types/chat.types';

interface UseMessageInitializationParams {
  fetchedMessages: Message[];
  chatId: string | undefined;
  selectedModelId: string | null | undefined;
  initialPromptFromRoute: string | null;
  initialPromptSent: boolean;
  wasAborted: boolean;
  attachedFiles: File[];
  isLoading: boolean;
  isStreaming: boolean;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setInitialPrompt: (prompt: string) => void;
}

function normalizeMessage(msg: Message): Message {
  const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
  const processedAttachments = attachments.map((attachment) => {
    const fileType = detectFileType(
      attachment.filename || '',
      attachment.file_type === 'image' ? 'image/jpeg' : undefined,
    );

    return { ...attachment, file_type: fileType };
  });

  return {
    id: msg.id,
    chat_id: msg.chat_id,
    content_text: msg.content_text,
    content_render: msg.content_render,
    last_seq: msg.last_seq,
    active_stream_id: msg.active_stream_id,
    stream_status: msg.stream_status,
    role: msg.role,
    is_bot: msg.role === 'assistant',
    attachments: processedAttachments,
    created_at: msg.created_at,
    model_id: msg.model_id,
    duration_ms: msg.duration_ms,
    checkpoint_id: msg.checkpoint_id,
    tool_results_omitted: msg.tool_results_omitted,
  };
}

// Normalize fetched messages into local state; inject synthetic user msg for route initial prompts.
export function useMessageInitialization({
  fetchedMessages,
  chatId,
  selectedModelId,
  initialPromptFromRoute,
  initialPromptSent,
  wasAborted,
  attachedFiles,
  isLoading,
  isStreaming,
  setMessages,
  setInitialPrompt,
}: UseMessageInitializationParams) {
  const initializedChatRef = useRef<string | undefined>(undefined);
  const lastMergedIdsRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!fetchedMessages || !chatId || wasAborted) return;

    if (isLoading || (isStreaming && initializedChatRef.current === chatId)) {
      const fetchedIds = `${chatId}:${fetchedMessages.map((message) => message.id).join(',')}`;
      if (lastMergedIdsRef.current === fetchedIds) return;
      lastMergedIdsRef.current = fetchedIds;
      setMessages((prev) => {
        const existingIds = new Set(prev.map((message) => message.id));
        if (fetchedMessages.every((message) => existingIds.has(message.id))) return prev;
        const incoming = fetchedMessages.map((message) =>
          existingIds.has(message.id) ? message : normalizeMessage(message),
        );
        return insertMessagesById(prev, incoming);
      });
      return;
    }

    lastMergedIdsRef.current = undefined;
    const normalizedMessages = fetchedMessages.map(normalizeMessage);

    // Persist the highest seq from fetched messages so stream reconnection
    // (useStreamReconnect) can resume from the correct cursor on page refresh.
    const latestKnownSeq = normalizedMessages.reduce((maxSeq, message) => {
      const seq = Number(message.last_seq);
      return Number.isFinite(seq) && seq > maxSeq ? seq : maxSeq;
    }, 0);
    if (latestKnownSeq > 0) {
      chatStorage.setEventId(chatId, String(latestKnownSeq));
    }

    if (
      initialPromptFromRoute &&
      initializedChatRef.current !== chatId &&
      normalizedMessages.length === 0 &&
      !initialPromptSent &&
      selectedModelId
    ) {
      initializedChatRef.current = chatId;
      const initialMessage = createInitialMessage(
        initialPromptFromRoute,
        attachedFiles,
        selectedModelId,
        chatId,
      );
      setMessages([initialMessage]);
      setInitialPrompt(initialPromptFromRoute);
    } else if (normalizedMessages.length > 0) {
      initializedChatRef.current = chatId;
      if (isStreaming) {
        setMessages((prev) => insertMessagesById(prev, normalizedMessages));
      } else {
        setMessages(normalizedMessages);
      }
    }
  }, [
    fetchedMessages,
    chatId,
    selectedModelId,
    initialPromptSent,
    wasAborted,
    initialPromptFromRoute,
    attachedFiles,
    isLoading,
    isStreaming,
    setMessages,
    setInitialPrompt,
  ]);
}
