import { detectFileType } from './fileTypes';
import type { Message } from '@/types/chat.types';

export type ChatStatusTone = 'blocked' | 'running' | 'completed' | 'unread';

export function chatStatusTone(flags: {
  blocked: boolean;
  streaming: boolean;
  completed: boolean;
  unread?: boolean;
}): ChatStatusTone | null {
  if (flags.blocked) return 'blocked';
  if (flags.streaming) return 'running';
  if (flags.completed) return 'completed';
  if (flags.unread) return 'unread';
  return null;
}

export const CHAT_STATUS_LABEL: Record<ChatStatusTone, string> = {
  blocked: 'Needs you',
  running: 'Running',
  completed: 'Done',
  unread: 'Unread',
};

export const isAssistantMessage = (msg: Message) => msg.is_bot ?? msg.role === 'assistant';

export function createInitialMessage(
  prompt: string,
  attachedFiles: File[] | null,
  modelId: string,
  chatId: string,
): Message {
  return {
    id: crypto.randomUUID(),
    chat_id: chatId,
    content_text: prompt,
    content_render: {
      events: [{ type: 'user_text', text: prompt }],
    },
    last_seq: 0,
    active_stream_id: null,
    stream_status: 'completed',
    role: 'user',
    is_bot: false,
    attachments:
      attachedFiles && attachedFiles.length > 0
        ? attachedFiles.map((file) => {
            const fileUrl = URL.createObjectURL(file);
            return {
              id: crypto.randomUUID(),
              message_id: crypto.randomUUID(),
              file_url: fileUrl,
              file_type: detectFileType(file.name, file.type),
              filename: file.name,
              created_at: new Date().toISOString(),
            };
          })
        : [],
    created_at: new Date().toISOString(),
    model_id: modelId,
    duration_ms: null,
    checkpoint_id: null,
  };
}

export function createAttachmentsFromFiles(
  files: File[] | null,
  storeBlobUrl: (file: File, url: string) => void,
) {
  if (!files || files.length === 0) return undefined;

  return files.map((file) => {
    const fileType = detectFileType(file.name, file.type);
    const blobUrl = URL.createObjectURL(file);

    if (fileType === 'pdf') {
      storeBlobUrl(file, blobUrl);
    }

    return {
      id: crypto.randomUUID(),
      message_id: Date.now().toString(),
      file_url: blobUrl,
      file_type: fileType,
      filename: file.name,
      created_at: new Date().toISOString(),
    };
  });
}
