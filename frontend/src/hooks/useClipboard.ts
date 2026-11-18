import { useCallback, useRef, useState } from 'react';
import { resolveChatClient } from '@/lib/api';
import type { MessageAttachment } from '@/types/chat.types';
import { toDownloadUrl } from '@/utils/attachmentUrl';
import { fetchAttachmentBlob, getDefaultFilename } from '@/utils/file';
import { logger } from '@/utils/logger';
import { extractAssistantText } from '@/utils/stream';

interface CopiedAttachments {
  text: string;
  attachments: MessageAttachment[];
  chatId: string | undefined;
}

interface UseClipboardParams {
  chatId: string | undefined;
}

interface UseClipboardResult {
  copiedMessageId: string | null;
  handleCopy: (content: string, id: string, attachments?: MessageAttachment[]) => Promise<void>;
}

let copiedAttachments: CopiedAttachments | null = null;

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

async function toFile(
  attachment: MessageAttachment,
  index: number,
  chatId: string | undefined,
): Promise<File> {
  if (attachment.file_url instanceof File) return attachment.file_url;
  const blob = await fetchAttachmentBlob(
    toDownloadUrl(attachment.file_url),
    resolveChatClient(chatId),
  );
  return new File([blob], attachment.filename ?? getDefaultFilename(attachment.file_type, index), {
    type: blob.type,
  });
}

export function loadCopiedAttachmentFiles(pastedText: string): Promise<File[]> | null {
  if (!copiedAttachments || copiedAttachments.text !== normalizeLineEndings(pastedText)) {
    return null;
  }
  const { attachments, chatId } = copiedAttachments;
  return Promise.all(attachments.map((attachment, index) => toFile(attachment, index, chatId)));
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
        copiedAttachments = attachments?.length
          ? { text: normalizeLineEndings(textToCopy), attachments, chatId }
          : null;
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
