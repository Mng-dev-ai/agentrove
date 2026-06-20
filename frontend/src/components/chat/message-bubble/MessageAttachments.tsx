import { memo } from 'react';
import { AttachmentViewer } from '@/components/ui/AttachmentViewer';
import type { MessageAttachment } from '@/types/chat.types';

interface MessageAttachmentsProps {
  attachments: MessageAttachment[];
  uploadingAttachmentIds?: string[];
  className?: string;
  chatId?: string;
}

export const MessageAttachments = memo(
  ({ attachments, uploadingAttachmentIds, className = '', chatId }: MessageAttachmentsProps) => {
    if (attachments.length === 0) {
      return null;
    }

    return (
      <div className={className}>
        <AttachmentViewer
          attachments={attachments}
          uploadingAttachmentIds={uploadingAttachmentIds}
          chatId={chatId}
        />
      </div>
    );
  },
);
