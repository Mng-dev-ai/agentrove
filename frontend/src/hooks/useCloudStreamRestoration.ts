import { useEffect } from 'react';
import { logger } from '@/utils/logger';
import { useStreamStore } from '@/store/streamStore';
import type { Chat } from '@/types/chat.types';
import type { StreamMetadata } from '@/types/stream.types';
import { chatService } from '@/services/chatService';

interface UseCloudStreamRestorationOptions {
  chats: Chat[] | undefined;
  isLoading: boolean;
  enabled?: boolean;
}

// After each cloud chat-list poll, writes StreamMetadata entries for any chat (or
// sub-thread) with an active backend task so the sidebar can show streaming
// indicators without waiting for the user to open each chat. Checks the 20
// most recent chats to keep the fan-out bounded. Cloud has no push channel, so
// this reruns on each changed list (deduping already-tracked chats) instead of
// latching after the first pass.
export function useCloudStreamRestoration({
  chats,
  isLoading,
  enabled = true,
}: UseCloudStreamRestorationOptions) {
  useEffect(() => {
    if (!enabled || isLoading || !chats || chats.length === 0) {
      return;
    }

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
          logger.error('Failed to check chat status', 'useCloudStreamRestoration', {
            chatId,
            error,
          });
        }
      };

      const chatCheckPromises = chatsToCheck.map((chat) => checkAndRegister(chat.id));

      // Fetch sub-threads for parents that have them and check each for active
      // streams. Per-chat fan-out is unavoidable here: only the chat-scoped client
      // reaches the remote instance. Local restoration uses the bulk endpoint in
      // useLocalStreamRestoration instead.
      const subThreadPromises = chatsToCheck
        .filter((chat) => chat.sub_thread_count > 0)
        .map(async (chat) => {
          try {
            const subThreads = await chatService.getSubThreads(chat.id);
            await Promise.allSettled(subThreads.map((sub) => checkAndRegister(sub.id)));
          } catch (error) {
            logger.error('Failed to restore sub-thread streams', 'useCloudStreamRestoration', {
              chatId: chat.id,
              error,
            });
          }
        });

      await Promise.allSettled([...chatCheckPromises, ...subThreadPromises]);
    };

    discoverActiveStreams().catch((error) => {
      logger.error('Stream restoration failed', 'useCloudStreamRestoration', error);
    });
  }, [chats, isLoading, enabled]);
}
