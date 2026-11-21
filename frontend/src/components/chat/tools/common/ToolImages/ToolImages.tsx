import { memo } from 'react';
import type { ToolImage } from '@/types/tools.types';
import { buildImageAttachment } from '@/utils/imageAttachment';
import { AttachmentViewer } from '@/components/ui/attachment-viewer/AttachmentViewer';

interface ToolImagesProps {
  toolId: string;
  fileName: string;
  images: ToolImage[];
}

export const ToolImages = memo(function ToolImages({ toolId, fileName, images }: ToolImagesProps) {
  const attachments = images.map((image, index) =>
    buildImageAttachment(`${toolId}-${index}`, fileName, image.mime_type, image.data),
  );
  return <AttachmentViewer attachments={attachments} size="large" />;
});
