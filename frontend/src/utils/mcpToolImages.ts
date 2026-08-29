import type { MessageAttachment } from '@/types/chat.types';

// MCP tool results can carry base64 image content blocks (e.g. browser
// screenshots) in two shapes: Anthropic-style
// { type: 'image', source: { type: 'base64', media_type, data } } and
// MCP-standard { type: 'image', data, mimeType }. Extract them so tool cards
// can render real images instead of dumping base64 into the JSON output.

interface ImageBlock {
  mediaType: string;
  data: string;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const asImageBlock = (block: unknown): ImageBlock | null => {
  if (typeof block !== 'object' || block === null) return null;
  const candidate = block as Record<string, unknown>;
  if (candidate.type !== 'image') return null;

  const source = candidate.source;
  if (typeof source === 'object' && source !== null) {
    const { media_type: mediaType, data } = source as Record<string, unknown>;
    if (typeof data === 'string' && data) {
      return {
        mediaType: typeof mediaType === 'string' && mediaType ? mediaType : 'image/png',
        data,
      };
    }
  }

  if (typeof candidate.data === 'string' && candidate.data) {
    const mimeType = candidate.mimeType;
    return {
      mediaType: typeof mimeType === 'string' && mimeType ? mimeType : 'image/png',
      data: candidate.data,
    };
  }

  return null;
};

export interface ExtractedToolImages {
  attachments: MessageAttachment[];
  // The result with image blocks removed, so the text output renders without base64 noise.
  remainder: unknown;
}

export const extractToolResultImages = (toolId: string, result: unknown): ExtractedToolImages => {
  const images: ImageBlock[] = [];

  const filterBlocks = (blocks: unknown[]): unknown[] =>
    blocks.filter((block) => {
      const image = asImageBlock(block);
      if (image) {
        images.push(image);
        return false;
      }
      return true;
    });

  let remainder: unknown = result;

  if (Array.isArray(result)) {
    const rest = filterBlocks(result);
    if (images.length > 0) {
      remainder = rest.length > 0 ? rest : null;
    }
  } else if (asImageBlock(result)) {
    images.push(asImageBlock(result)!);
    remainder = null;
  } else if (typeof result === 'object' && result !== null) {
    const record = result as Record<string, unknown>;
    if (Array.isArray(record.content)) {
      const rest = filterBlocks(record.content);
      if (images.length > 0) {
        const next: Record<string, unknown> = { ...record };
        if (rest.length > 0) {
          next.content = rest;
        } else {
          delete next.content;
        }
        remainder = Object.keys(next).length > 0 ? next : null;
      }
    }
  }

  const attachments = images.map((image, index): MessageAttachment => {
    const extension = IMAGE_EXTENSIONS[image.mediaType] ?? 'png';
    return {
      id: `${toolId}-image-${index}`,
      message_id: '',
      file_url: `data:${image.mediaType};base64,${image.data}`,
      file_type: 'image',
      filename:
        images.length > 1 ? `screenshot-${index + 1}.${extension}` : `screenshot.${extension}`,
      created_at: '',
    };
  });

  return { attachments, remainder };
};
