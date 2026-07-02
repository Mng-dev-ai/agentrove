import { useEffect, useRef } from 'react';
import { logger } from '@/utils/logger';
import { useStreamStore } from '@/store/streamStore';
import type { StreamMetadata } from '@/types/stream.types';
import { chatService } from '@/services/chatService';

// Restores local streams in one bulk request — the backend enumerates its
// in-process stream registry, so no per-chat or per-sub-thread status fan-out
// is needed no matter how many chats or sub-threads exist.
export function useLocalStreamRestoration({ enabled }: { enabled: boolean }) {
  const hasRestoredRef = useRef(false);

  useEffect(() => {
    if (!enabled || hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    const restore = async () => {
      const active = await chatService.getActiveStreams();
      const tracked = new Set(
        useStreamStore.getState().activeStreamMetadata.map((meta) => meta.chatId),
      );
      for (const stream of active) {
        if (tracked.has(stream.chat_id)) continue;
        const metadata: StreamMetadata = {
          chatId: stream.chat_id,
          messageId: stream.message_id,
          startTime: Date.now(),
        };
        useStreamStore.getState().addStreamMetadata(metadata);
      }
    };

    restore().catch((error) => {
      logger.error('Stream restoration failed', 'useLocalStreamRestoration', error);
    });
  }, [enabled]);
}
