import type { MessageAttachment } from '@/types/chat.types';
import { formatBytes } from '@/utils/format';

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
  caption: string | null;
  remainder: unknown;
}

interface ScreenshotMetadata {
  size_bytes?: number;
  viewport?: {
    width: number;
    height: number;
  };
}

const asScreenshotMetadata = (block: unknown): ScreenshotMetadata | null => {
  if (typeof block !== 'object' || block === null) return null;
  const textBlock = block as Record<string, unknown>;
  if (textBlock.type !== 'text' || typeof textBlock.text !== 'string') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const metadata = parsed as Record<string, unknown>;
  const keys = Object.keys(metadata);
  if (keys.length === 0 || keys.some((key) => key !== 'size_bytes' && key !== 'viewport')) {
    return null;
  }

  let sizeBytes: number | undefined;
  if ('size_bytes' in metadata) {
    if (
      typeof metadata.size_bytes !== 'number' ||
      !Number.isFinite(metadata.size_bytes) ||
      metadata.size_bytes < 0
    ) {
      return null;
    }
    sizeBytes = metadata.size_bytes;
  }

  let parsedViewport: ScreenshotMetadata['viewport'];
  if ('viewport' in metadata) {
    if (
      typeof metadata.viewport !== 'object' ||
      metadata.viewport === null ||
      Array.isArray(metadata.viewport)
    ) {
      return null;
    }
    const viewport = metadata.viewport as Record<string, unknown>;
    if (
      Object.keys(viewport).length !== 2 ||
      !('width' in viewport) ||
      !('height' in viewport) ||
      typeof viewport.width !== 'number' ||
      !Number.isFinite(viewport.width) ||
      typeof viewport.height !== 'number' ||
      !Number.isFinite(viewport.height)
    ) {
      return null;
    }
    parsedViewport = { width: viewport.width, height: viewport.height };
  }

  return { size_bytes: sizeBytes, viewport: parsedViewport };
};

const extractScreenshotCaption = (remainder: unknown): string | null => {
  if (!Array.isArray(remainder) || remainder.length === 0) return null;
  const metadata = remainder.map(asScreenshotMetadata);
  if (metadata.some((item) => item === null)) return null;

  const parts: string[] = [];
  for (const item of metadata) {
    if (item?.viewport) parts.push(`${item.viewport.width} × ${item.viewport.height}`);
  }
  for (const item of metadata) {
    if (item?.size_bytes !== undefined) parts.push(formatBytes(item.size_bytes));
  }
  return parts.join(' · ');
};

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
  let caption: string | null = null;

  if (Array.isArray(result)) {
    const rest = filterBlocks(result);
    if (images.length > 0) {
      caption = extractScreenshotCaption(rest);
      remainder = caption !== null || rest.length === 0 ? null : rest;
    }
  } else if (asImageBlock(result)) {
    images.push(asImageBlock(result)!);
    remainder = null;
  } else if (typeof result === 'object' && result !== null) {
    const record = result as Record<string, unknown>;
    if (Array.isArray(record.content)) {
      const rest = filterBlocks(record.content);
      if (images.length > 0) {
        caption = extractScreenshotCaption(rest);
        const next: Record<string, unknown> = { ...record };
        if (rest.length > 0 && !caption) {
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

  return { attachments, caption, remainder };
};
