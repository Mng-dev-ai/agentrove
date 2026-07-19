import { useEffect, useRef } from 'react';
import { logger } from '@/utils/logger';
import { registerActiveStreams } from '@/utils/activeStreams';
import { chatService } from '@/services/chatService';

// One bulk restore against the backend's in-process registry — no per-chat status fan-out.
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
