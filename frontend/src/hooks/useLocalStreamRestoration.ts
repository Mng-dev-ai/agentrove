import { useEffect, useRef } from 'react';
import { logger } from '@/utils/logger';
import { registerActiveStreams } from '@/utils/activeStreams';
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
      registerActiveStreams(await chatService.getActiveStreams());
    };

    restore().catch((error) => {
      logger.error('Stream restoration failed', 'useLocalStreamRestoration', error);
    });
  }, [enabled]);
}
