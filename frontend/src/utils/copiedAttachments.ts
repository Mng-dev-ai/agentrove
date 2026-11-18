import { resolveChatClient } from '@/lib/api';
import type { MessageAttachment } from '@/types/chat.types';
import { getDefaultFilename, resolveAttachmentBlob } from '@/utils/file';
import { logger } from '@/utils/logger';

interface CopiedAttachments {
  text: string;
  files: Promise<File[]>;
}

let copied: CopiedAttachments | null = null;

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

async function toFile(
  attachment: MessageAttachment,
  index: number,
  apiClient: ReturnType<typeof resolveChatClient>,
): Promise<File> {
  const blob = await resolveAttachmentBlob(attachment.file_url, apiClient);
  return new File([blob], attachment.filename ?? getDefaultFilename(attachment.file_type, index), {
    type: blob.type,
  });
}

export function rememberCopiedAttachments(
  text: string,
  attachments: MessageAttachment[],
  chatId: string | undefined,
): void {
  if (attachments.length === 0) {
    copied = null;
    return;
  }
  const apiClient = resolveChatClient(chatId);
  const files = Promise.all(
    attachments.map((attachment, index) => toFile(attachment, index, apiClient)),
  );
  files.catch((error) =>
    logger.error('Copied attachments download failed', 'copiedAttachments', error),
  );
  copied = { text: normalizeLineEndings(text), files };
}

export function getCopiedAttachments(pastedText: string): Promise<File[]> | null {
  return copied?.text === normalizeLineEndings(pastedText) ? copied.files : null;
}
