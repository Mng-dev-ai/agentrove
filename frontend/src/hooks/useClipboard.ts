import { useCallback, useEffect, useState } from 'react';
import { logger } from '@/utils/logger';
import { extractAssistantText } from '@/utils/stream';

// navigator.clipboard is only available in secure contexts (HTTPS).
// Fall back to the legacy execCommand approach for HTTP (e.g. LAN deployments).
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
}

interface UseClipboardParams {
  chatId: string | undefined;
}

interface UseClipboardResult {
  copiedMessageId: string | null;
  handleCopy: (content: string, id: string) => Promise<void>;
}

export function useClipboard({ chatId }: UseClipboardParams): UseClipboardResult {
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const handleCopy = useCallback(async (content: string, id: string) => {
    try {
      const textToCopy = extractAssistantText(content) || content;
      await copyToClipboard(textToCopy);
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (error) {
      logger.error('Clipboard copy failed', 'useClipboard', error);
    }
  }, []);

  useEffect(() => {
    setCopiedMessageId(null);
  }, [chatId]);

  return {
    copiedMessageId,
    handleCopy,
  };
}
