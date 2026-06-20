import { useEffect, useRef } from 'react';
import { logger } from '@/utils/logger';
import { useStreamStore } from '@/store/streamStore';
import type { Chat } from '@/types/chat.types';
import type { StreamMetadata } from '@/types/stream.types';
import { chatService } from '@/services/chatService';

interface UseStreamRestorationOptions {
  chats: Chat[] | undefined;
  isLoading: boolean;
  enabled?: boolean;
  // Cloud has no push channel, so the list is polled — rerun restoration on each
  // changed list (deduping already-tracked chats) instead of latching after the
  // first pass. Local stays single-pass: its global SSE surfaces new runs live.
  continuous?: boolean;
}

// After the chat list loads, writes StreamMetadata entries for any chat (or
// sub-thread) with an active backend task so the sidebar can show streaming
// indicators without waiting for the user to open each chat. Checks the 20
// most recent chats to keep the fan-out bounded.
export function useStreamRestoration({
  chats,
  isLoading,
  enabled = true,
  continuous = false,
}: UseStreamRestorationOptions) {
  const hasRestoredRef = useRef(false);

  useEffect(() => {
    if (!enabled || isLoading || !chats || chats.length === 0) {
      return;
    }
    if (!continuous && hasRestoredRef.current) {
      return;
    }

    hasRestoredRef.current = true;

    const discoverActiveStreams = async () => {
      // Skip chats already tracked — avoids redundant status checks on reruns and
      // keeps an existing entry's startTime from resetting on each poll.
      const tracked = new Set(
        useStreamStore.getState().activeStreamMetadata.map((meta) => meta.chatId),
      );
      const chatsToCheck = chats.slice(0, 20);

      const checkAndRegister = async (chatId: string) => {
        if (tracked.has(chatId)) return;
        try {
          const status = await chatService.checkChatStatus(chatId);
          if (status?.has_active_task && status.message_id) {
            const metadata: StreamMetadata = {
              chatId,
              messageId: status.message_id,
              startTime: Date.now(),
            };
            useStreamStore.getState().addStreamMetadata(metadata);
          }
        } catch (error) {
          logger.error('Failed to check chat status', 'useStreamRestoration', {
            chatId,
            error,
          });
        }
      };

      const chatCheckPromises = chatsToCheck.map((chat) => checkAndRegister(chat.id));

      // Fetch sub-threads for parents that have them and check each for active
      // streams. This fans out into N additional requests per parent — acceptable
      // for a single-user app. A bulk active-streams endpoint would reduce this.
      const subThreadPromises = chatsToCheck
        .filter((chat) => chat.sub_thread_count > 0)
        .map(async (chat) => {
          try {
            const subThreads = await chatService.getSubThreads(chat.id);
            await Promise.allSettled(subThreads.map((sub) => checkAndRegister(sub.id)));
          } catch (error) {
            logger.error('Failed to restore sub-thread streams', 'useStreamRestoration', {
              chatId: chat.id,
              error,
            });
          }
        });

      await Promise.allSettled([...chatCheckPromises, ...subThreadPromises]);
    };

    discoverActiveStreams().catch((error) => {
      logger.error('Stream restoration failed', 'useStreamRestoration', error);
    });
  }, [chats, isLoading, enabled, continuous]);

  return { hasRestored: hasRestoredRef.current };
}
