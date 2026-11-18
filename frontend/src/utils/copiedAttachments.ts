import { resolveChatClient } from '@/lib/api';
import type { MessageAttachment } from '@/types/chat.types';
import { getDefaultFilename, resolveAttachmentBlob } from '@/utils/file';
import { logger } from '@/utils/logger';

type CopiedFiles =
  | { status: 'loading' }
  | { status: 'ready'; files: File[] }
  | { status: 'failed' };

interface CopiedAttachments {
  text: string;
  files: CopiedFiles;
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
  const entry: CopiedAttachments = {
    text: normalizeLineEndings(text),
    files: { status: 'loading' },
  };
  copied = entry;
  const apiClient = resolveChatClient(chatId);
  Promise.all(attachments.map((attachment, index) => toFile(attachment, index, apiClient)))
    .then((files) => {
      entry.files = { status: 'ready', files };
    })
    .catch((error) => {
      logger.error('Copied attachments download failed', 'copiedAttachments', error);
      entry.files = { status: 'failed' };
    });
}

export function getCopiedAttachments(pastedText: string): CopiedFiles | null {
  return copied?.text === normalizeLineEndings(pastedText) ? copied.files : null;
}
