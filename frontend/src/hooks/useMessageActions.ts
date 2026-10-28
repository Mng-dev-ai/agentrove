import { useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { logger } from '@/utils/logger';
import { createAttachmentsFromFiles } from '@/utils/message';
import { MAX_MESSAGE_SIZE_BYTES } from '@/config/constants';
import { useChatSettings } from '@/hooks/useChatSettings';
import { buildAgentChatFields } from '@/utils/chatRequest';
import { useChatContext } from '@/hooks/useChatContext';
import { useModelMap } from '@/hooks/queries/useModelQueries';
import type { ChatRequest, Message } from '@/types/chat.types';
import type { StreamState } from '@/types/stream.types';

const textEncoder = new TextEncoder();

interface UseMessageActionsParams {
  chatId: string | undefined;
  selectedModelId: string | null | undefined;
  worktree: boolean;
  baseBranch: string | undefined;
  fastMode: boolean;
  setStreamState: (state: StreamState) => void;
  setCurrentMessageId: (id: string | null) => void;
  setWasAborted: (aborted: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  addMessageToCache: (message: Message, userMessage?: Message) => void;
  startStream: (
    request: ChatRequest,
    signal?: AbortSignal,
  ) => Promise<{ messageId: string; checkpointId: string | null }>;
  setPendingUserMessageId: (id: string | null) => void;
  isLoading: boolean;
  isStreaming: boolean;
}

// Detects a leftover empty assistant message (e.g., from a previous failed
// stream start) so sendMessage can replace it rather than stacking duplicates.
const isEmptyBotPlaceholder = (msg?: Message) =>
  !!msg?.is_bot &&
  (!msg?.content_render?.events || msg.content_render.events.length === 0) &&
  !msg.content_text;

// `sendMessage` opens the SSE stream + injects the assistant placeholder;
// `handleMessageSend` validates, optimistically inserts the user message, and rolls back on failure.
export function useMessageActions({
  chatId,
  selectedModelId,
  worktree,
  baseBranch,
  fastMode,
  setStreamState,
  setCurrentMessageId,
  setWasAborted,
  setMessages,
  addMessageToCache,
  startStream,
  setPendingUserMessageId,
  isLoading,
  isStreaming,
}: UseMessageActionsParams) {
  const { personas } = useChatContext();
  const modelMap = useModelMap();
  const { permissionMode, thinkingMode, persona } = useChatSettings(chatId);
  const pendingStartControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (
      prompt: string,
      chatIdOverride?: string,
      userMessage?: Message,
      filesToSend?: File[],
    ) => {
      const normalizedPrompt = prompt.trim();
      if (!normalizedPrompt) return;

      if (!selectedModelId?.trim()) {
        toast.error('Please select an AI model');
        setStreamState('idle');
        return;
      }

      setStreamState('loading');
      setCurrentMessageId(null);
      setWasAborted(false);
      if (filesToSend && filesToSend.length > 0 && userMessage?.id) {
        setPendingUserMessageId(userMessage.id);
      }

      const startController = new AbortController();
      pendingStartControllerRef.current = startController;

      try {
        const request: ChatRequest = {
          prompt: normalizedPrompt,
          user_message_id: userMessage?.id,
          model_id: selectedModelId,
          ...(chatIdOverride && { chat_id: chatIdOverride }),
          attached_files: filesToSend && filesToSend.length > 0 ? filesToSend : undefined,
          ...buildAgentChatFields(
            selectedModelId,
            modelMap,
            {
              permissionMode,
              thinkingMode,
              worktree,
              baseBranch,
              fastMode,
              persona,
            },
            personas,
          ),
        };

        const { messageId, checkpointId } = await startStream(request, startController.signal);
        pendingStartControllerRef.current = null;

        setCurrentMessageId(messageId);
        setStreamState('streaming');

        const initialMessage: Message = {
          id: messageId,
          chat_id: chatIdOverride ?? chatId ?? '',
          content_text: '',
          content_render: { events: [] },
          last_seq: 0,
          active_stream_id: null,
          stream_status: 'in_progress',
          role: 'assistant',
          is_bot: true,
          attachments: [],
          created_at: new Date().toISOString(),
          model_id: selectedModelId ?? undefined,
          duration_ms: null,
          checkpoint_id: checkpointId,
          tool_results_omitted: false,
        };

        setMessages((prev) => {
          if (prev.some((message) => message.id === messageId)) return prev;
          const lastMessage = prev[prev.length - 1];
          if (isEmptyBotPlaceholder(lastMessage)) {
            return [...prev.slice(0, -1), initialMessage];
          }
          return [...prev, initialMessage];
        });
        addMessageToCache(initialMessage, userMessage);
      } catch (streamStartError) {
        pendingStartControllerRef.current = null;
        setPendingUserMessageId(null);
        setStreamState('idle');
        // The service layer wraps abort errors inconsistently (direct ServiceError
        // pre-check vs. wrapped DOMException mid-fetch), so trust the controller
        // signal as the authoritative source of "did we cancel this".
        if (startController.signal.aborted) {
          return;
        }
        const error =
          streamStartError instanceof Error
            ? streamStartError
            : new Error('Failed to start stream');
        toast.error(error.message);
        throw error;
      }
    },
    [
      chatId,
      addMessageToCache,
      modelMap,
      personas,
      persona,
      permissionMode,
      selectedModelId,
      startStream,
      thinkingMode,
      worktree,
      baseBranch,
      fastMode,
      setStreamState,
      setCurrentMessageId,
      setWasAborted,
      setMessages,
      setPendingUserMessageId,
    ],
  );

  const cancelPendingStart = useCallback(() => {
    // Loading-state stop has no stream/message ID yet, so abort the in-flight
    // start request directly instead of going through the post-registration stop path.
    pendingStartControllerRef.current?.abort();
    pendingStartControllerRef.current = null;
  }, []);

  const handleMessageSend = useCallback(
    async (inputMessage: string, inputFiles: File[]) => {
      const hasContent = inputMessage.trim();

      if (!hasContent || isLoading || isStreaming) return;

      if (!selectedModelId?.trim()) {
        toast.error('Please select an AI model');
        return;
      }

      const prompt = inputMessage;

      const byteSize = textEncoder.encode(prompt).length;

      if (byteSize > MAX_MESSAGE_SIZE_BYTES) {
        toast.error(`Message too large (${Math.round(byteSize / 1024)}KB).`);
        return;
      }

      const newMessage: Message = {
        id: crypto.randomUUID(),
        chat_id: chatId ?? '',
        content_text: prompt,
        content_render: {
          events: [{ type: 'user_text', text: prompt }],
        },
        last_seq: 0,
        active_stream_id: null,
        stream_status: 'completed',
        role: 'user',
        is_bot: false,
        model_id: selectedModelId,
        created_at: new Date().toISOString(),
        attachments: createAttachmentsFromFiles(inputFiles) ?? [],
        duration_ms: null,
        checkpoint_id: null,
        tool_results_omitted: false,
      };

      setMessages((prev) => [...prev, newMessage]);
      setPendingUserMessageId(newMessage.id);

      try {
        await sendMessage(newMessage.content_text, chatId, newMessage, inputFiles);
        return { success: true };
      } catch (error) {
        logger.error('Failed to send message', 'useMessageActions', error);
        setMessages((prev) => prev.filter((msg) => msg.id !== newMessage.id));
        setPendingUserMessageId(null);
        return { success: false };
      }
    },
    [
      chatId,
      isLoading,
      isStreaming,
      selectedModelId,
      sendMessage,
      setPendingUserMessageId,
      setMessages,
    ],
  );

  return {
    sendMessage,
    handleMessageSend,
    cancelPendingStart,
  };
}
