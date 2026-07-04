import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { X, Pencil, CornerDownRight, FileText, FileSpreadsheet, Send } from 'lucide-react';
import { Button } from '@/components/ui/primitives/Button';
import { Input } from '@/components/ui/primitives/Input';
import { Spinner } from '@/components/ui/primitives/Spinner';
import { apiClient } from '@/lib/api';
import { detectFileType } from '@/utils/fileTypes';
import { HighlightedText } from '@/components/ui/shared/HighlightedText';
import { fetchAttachmentBlob } from '@/utils/file';
import { isBrowserObjectUrl } from '@/utils/attachmentUrl';
import type {
  LocalQueuedMessage,
  QueueMessageAttachment as QueueAttachment,
} from '@/types/queue.types';

interface QueueMessageCardProps {
  message: LocalQueuedMessage;
  onCancel: (messageId: string) => void;
  onEdit: (messageId: string, newContent: string) => void;
  onSendNow: (messageId: string) => void;
}

function UploadingOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 rounded-md bg-black/35">
      <div className="absolute inset-0 flex items-center justify-center">
        <Spinner size="xs" className="text-white" />
      </div>
    </div>
  );
}

function LocalFilePreview({ file, uploading }: { file: File; uploading: boolean }) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'image' | 'pdf' | 'xlsx' | 'unknown'>('unknown');

  useEffect(() => {
    let objectUrl: string | null = null;

    try {
      const detectedType = detectFileType(file.name, file.type);
      setFileType(detectedType);

      if (detectedType === 'image') {
        objectUrl = URL.createObjectURL(file);
        setImageSrc(objectUrl);
      }
    } catch {
      setFileType('unknown');
    }

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [file]);

  if (fileType === 'image' && imageSrc) {
    return (
      <div className="relative h-8 w-8 rounded-md">
        <img
          src={imageSrc}
          alt={file.name || 'Attachment'}
          className="h-8 w-8 rounded-md object-cover"
        />
        {uploading && <UploadingOverlay />}
      </div>
    );
  }

  if (fileType === 'xlsx') {
    return (
      <div className="relative flex h-8 w-8 items-center justify-center rounded-md bg-surface-tertiary dark:bg-surface-dark-tertiary">
        <FileSpreadsheet className="h-4 w-4 text-success-600 dark:text-success-400" />
        {uploading && <UploadingOverlay />}
      </div>
    );
  }

  if (fileType === 'pdf') {
    return (
      <div className="relative flex h-8 w-8 items-center justify-center rounded-md bg-surface-tertiary dark:bg-surface-dark-tertiary">
        <FileText className="h-4 w-4 text-error-500 dark:text-error-400" />
        {uploading && <UploadingOverlay />}
      </div>
    );
  }

  return (
    <div className="relative flex h-8 w-8 items-center justify-center rounded-md bg-surface-tertiary dark:bg-surface-dark-tertiary">
      <FileText className="h-4 w-4 text-text-tertiary dark:text-text-dark-tertiary" />
      {uploading && <UploadingOverlay />}
    </div>
  );
}

function AuthenticatedPreview({ attachment }: { attachment: QueueAttachment }) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadImage() {
      try {
        if (isBrowserObjectUrl(attachment.file_url)) {
          setImageSrc(attachment.file_url);
          setIsLoading(false);
          return;
        }

        const blob = await fetchAttachmentBlob(attachment.file_url, apiClient);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImageSrc(objectUrl);
        setIsLoading(false);
      } catch {
        if (!cancelled) {
          setError(true);
          setIsLoading(false);
        }
      }
    }

    if (attachment.file_type === 'image') {
      loadImage();
    } else {
      setIsLoading(false);
    }

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.file_url, attachment.file_type]);

  if (attachment.file_type === 'pdf') {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-tertiary dark:bg-surface-dark-tertiary">
        <FileText className="h-4 w-4 text-error-500 dark:text-error-400" />
      </div>
    );
  }

  if (attachment.file_type === 'xlsx') {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-tertiary dark:bg-surface-dark-tertiary">
        <FileSpreadsheet className="h-4 w-4 text-success-600 dark:text-success-400" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-tertiary dark:bg-surface-dark-tertiary">
        <div className="h-3 w-3 animate-pulse rounded-full bg-text-quaternary dark:bg-text-dark-quaternary" />
      </div>
    );
  }

  if (error || !imageSrc) {
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-tertiary dark:bg-surface-dark-tertiary">
        <span className="text-2xs text-text-tertiary dark:text-text-dark-tertiary">Error</span>
      </div>
    );
  }

  return (
    <img
      src={imageSrc}
      alt={attachment.filename || 'Attachment'}
      className="h-8 w-8 rounded-md object-cover"
    />
  );
}

export const QueueMessageCard = memo(function QueueMessageCard({
  message,
  onCancel,
  onEdit,
  onSendNow,
}: QueueMessageCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasLocalFiles = message.files && message.files.length > 0;
  const hasServerAttachments = message.attachments && message.attachments.length > 0;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(editContent.length, editContent.length);
    }
  }, [isEditing, editContent.length]);

  const handleStartEdit = useCallback(() => {
    setEditContent(message.content);
    setIsEditing(true);
  }, [message.content]);

  const handleCancelEdit = useCallback(() => {
    setEditContent(message.content);
    setIsEditing(false);
  }, [message.content]);

  const handleSaveEdit = useCallback(() => {
    const trimmed = editContent.trim();
    if (!trimmed) {
      onCancel(message.id);
    } else {
      onEdit(message.id, trimmed);
    }
    setIsEditing(false);
  }, [editContent, message.id, onCancel, onEdit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSaveEdit();
      } else if (e.key === 'Escape') {
        handleCancelEdit();
      }
    },
    [handleSaveEdit, handleCancelEdit],
  );

  return (
    <div className="flex w-full flex-col px-3 py-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <CornerDownRight className="h-3 w-3 shrink-0 text-text-quaternary dark:text-text-dark-quaternary" />
          {hasLocalFiles && !hasServerAttachments && (
            <div className="flex flex-wrap gap-1">
              {message.files!.map((file, idx) => (
                <LocalFilePreview
                  key={`${file.name}-${file.lastModified}-${idx}`}
                  file={file}
                  uploading={!message.synced}
                />
              ))}
            </div>
          )}
          {hasServerAttachments && message.attachments && (
            <div className="flex flex-wrap gap-1">
              {message.attachments.map((att, idx) => (
                <AuthenticatedPreview key={att.file_url || idx} attachment={att} />
              ))}
            </div>
          )}
          {isEditing ? (
            <Input
              ref={inputRef}
              variant="unstyled"
              type="text"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Edit message"
              className="min-w-0 flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-quaternary focus:outline-none dark:text-text-dark-primary"
            />
          ) : (
            <span className="truncate text-xs text-text-secondary dark:text-text-dark-secondary">
              <HighlightedText text={message.content} />
            </span>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {message.sendingNow ? (
            <span className="flex items-center gap-1.5 px-1 text-2xs text-text-quaternary dark:text-text-dark-quaternary">
              <Spinner size="xs" />
              Sending...
            </span>
          ) : isEditing ? (
            <>
              <Button
                onClick={handleSaveEdit}
                variant="ghost"
                className="h-5 rounded-md px-1.5 py-0 text-2xs font-medium text-text-primary dark:text-text-dark-primary"
              >
                Save
              </Button>
              <Button
                onClick={handleCancelEdit}
                variant="ghost"
                className="h-5 rounded-md px-1.5 py-0 text-2xs font-medium text-text-tertiary dark:text-text-dark-tertiary"
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              {message.synced && (
                <Button
                  onClick={() => onSendNow(message.id)}
                  variant="ghost"
                  className="h-5 rounded-md px-1.5 py-0 text-text-tertiary hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
                  aria-label="Send now"
                >
                  <Send className="h-3 w-3" />
                </Button>
              )}
              <Button
                onClick={handleStartEdit}
                variant="ghost"
                className="h-5 rounded-md px-1.5 py-0 text-text-tertiary hover:text-text-primary dark:text-text-dark-tertiary dark:hover:text-text-dark-primary"
                aria-label="Edit message"
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                onClick={() => onCancel(message.id)}
                variant="ghost"
                className="h-5 rounded-md px-1.5 py-0 text-text-tertiary hover:bg-error-50 hover:text-error-600 dark:hover:bg-error-500/10 dark:hover:text-error-400"
                aria-label="Cancel message"
              >
                <X className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
});
