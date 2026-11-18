import { useCallback, useRef, useState } from 'react';
import type { MessageAttachment } from '@/types/chat.types';
import { rememberCopiedAttachments } from '@/utils/copiedAttachments';
import { logger } from '@/utils/logger';
import { extractAssistantText } from '@/utils/stream';

interface UseClipboardParams {
  chatId: string | undefined;
}

interface UseClipboardResult {
  copiedMessageId: string | null;
  handleCopy: (content: string, id: string, attachments?: MessageAttachment[]) => Promise<void>;
}

export function useClipboard({ chatId }: UseClipboardParams): UseClipboardResult {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const prevChatIdRef = useRef(chatId);

  if (prevChatIdRef.current !== chatId) {
    prevChatIdRef.current = chatId;
    setCopiedMessageId(null);
  }

  const handleCopy = useCallback(
    async (content: string, id: string, attachments?: MessageAttachment[]) => {
      try {
        const textToCopy = extractAssistantText(content) || content;
        await navigator.clipboard.writeText(textToCopy);
        rememberCopiedAttachments(textToCopy, attachments ?? [], chatId);
        setCopiedMessageId(id);
        setTimeout(() => setCopiedMessageId(null), 2000);
      } catch (error) {
        logger.error('Clipboard copy failed', 'useClipboard', error);
      }
    },
    [chatId],
  );

  return {
    copiedMessageId,
    handleCopy,
  };
}
