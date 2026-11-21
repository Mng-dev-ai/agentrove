import type { MessageAttachment } from '@/types/chat.types';

export const buildImageAttachment = (
  id: string,
  filename: string,
  mediaType: string,
  base64Data: string,
): MessageAttachment => ({
  id,
  file_url: `data:${mediaType};base64,${base64Data}`,
  file_type: 'image',
  filename,
  message_id: '',
  created_at: '',
});
